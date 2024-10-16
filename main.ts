import { Feed } from "npm:feed";
import * as hex from "jsr:@std/encoding@^1.0.5/hex";
import { concat } from "jsr:@std/bytes@^1.0.2";
import { bech32 } from "jsr:@scure/base@^1.1.7";
import {
    NostrEvent,
    NostrFilter,
    NPool,
    NPoolOpts,
    NRelay,
    NRelay1,
    NSet,
} from "jsr:@nostrify/nostrify@^0.36.0";

const sleep = (time: number) => {
    return new Promise((r) => setTimeout(r, time));
};

const get_events = async <T extends NRelay>(
    filter: NostrFilter,
    pool: NPool<T>,
    poolOpts: NPoolOpts<T>,
    opts?: { signal?: AbortSignal },
): Promise<NostrEvent[]> => {
    const controller = new AbortController();
    const signal = opts?.signal
        ? AbortSignal.any([opts.signal, controller.signal])
        : controller.signal;

    const routes = await poolOpts.reqRouter([filter]);
    if (routes.size < 1) {
        return [];
    }
    const events = new NSet();
    const deletionChecked: Set<string> = new Set();
    const ps: Promise<void>[] = [];

    // the timestamp of the most recent event among the oldest events from each relay
    let oldest = 0;
    for (const [url, filters] of routes.entries()) {
        const relay = pool.relay(url);
        ps.push(
            (async () => {
                let i = 0;
                const couldBeDeleted = [];
                for await (const msg of relay.req(filters, { signal })) {
                    if (msg[0] === "EOSE" || msg[0] === "CLOSED") {
                        break;
                    } else if (msg[0] === "EVENT") {
                        if (msg[2].created_at < oldest) {
                            break;
                        } else if (++i === filter.limit) {
                            oldest = Math.max(msg[2].created_at, oldest);
                            break;
                        }
                        if (!deletionChecked.has(msg[2].id)) {
                            couldBeDeleted.push(msg[2].id);
                            deletionChecked.add(msg[2].id);
                        }
                        events.add(msg[2]);
                    }
                }
                const deletions = await pool.query([{
                    "#e": couldBeDeleted,
                    kinds: [5],
                }]);
                for (const d of deletions) {
                    events.add(d);
                }
            })().catch(() => {}),
        );
    }

    await Promise.race([Promise.all(ps), sleep(3_000)]);
    controller.abort();

    return [...events].filter((a) => a.created_at >= oldest).toSorted((a, b) =>
        b.created_at - a.created_at || +(a.id > b.id)
    );
};

const decodeNpub = (lnurl: string) => {
    const { prefix, words } = bech32.decode(
        lnurl as `npub1${string}`,
        Infinity,
    );
    if (prefix !== "npub") throw new Error("invalid npub");
    const data = new Uint8Array(bech32.fromWords(words));
    return hex.encodeHex(data);
};

const poolOpts = {
    open: (url: string) => new NRelay1(url, { backoff: false }),
    // new NRelay1(url, {}),
    // deno-lint-ignore require-await -- false positive
    reqRouter: async (filters: NostrFilter[]) =>
        new Map([
            ["wss://relay.momostr.pink", filters],
            ["wss://relay.nostr.band", filters],
            ["wss://relay.damus.io", filters],
            ["wss://nos.lol", filters],
        ]),
    // deno-lint-ignore require-await -- false positive
    eventRouter: async (
        _event: NostrEvent,
    ) => [
        "wss://relay.momostr.pink",
    ],
};

const pool = new NPool(poolOpts);

const main = async (pubkey: string) => {
    const feed = new Feed({
        title: "Nostr Notification",
        id: pubkey,
        copyright: "",
    });
    const controller = new AbortController();
    for (
        const e of await get_events(
            {
                kinds: [1, 6, 7],
                limit: 10,
                "#p": [pubkey],
            },
            pool,
            poolOpts,
            { signal: controller.signal },
        )
    ) {
        if (e.pubkey === pubkey) {
            continue;
        }
        const nevent_array = concat([
            new Uint8Array([0, 32]),
            hex.decodeHex(e.id),
            new Uint8Array([2, 32]),
            hex.decodeHex(e.pubkey),
        ]);
        feed.addItem({
            title: `[kind:${e.kind}] ${e.content}`,
            link: "https://nostter.app/" +
                bech32.encode("nevent", bech32.toWords(nevent_array), Infinity),
            id: e.id,
            date: new Date(e.created_at * 1_000),
        });
    }

    controller.abort();
    return feed.atom1();
};

export default {
    async fetch(request: Request, _env: unknown) {
        const url = new URL(request.url);
        let pubkey;
        try {
            pubkey = decodeNpub(url.pathname.substring(1));
        } catch {
            return new Response(`usage: ${url.origin}/npub1...`);
        }
        try {
            return new Response(await main(pubkey));
        } catch (e) {
            return new Response(`internal error: ${e}`);
        }
    },
};
