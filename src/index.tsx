import { dlopen, suffix } from "bun:ffi";
import { EventEmitter } from "node:events";
import { constants, createBrotliCompress, brotliCompressSync } from "node:zlib";

const lib = dlopen(`zig-out/lib/libgol.${suffix}`, {
    init: {
        args: [],
        returns: "void",
    },
    step: {
        args: [],
        returns: "cstring",
    },
    free: {
        args: [],
        returns: "void",
    },
});

const width = 5000;
const size = width ** 2;
const emitter = new EventEmitter();
emitter.setMaxListeners(0);
let response: string;

lib.symbols.init();

setInterval(() => {
    if (emitter.listenerCount("tick") === 0) return;

    const signals = lib.symbols.step();
    response = `event:datastar-merge-signals\ndata:signals ${signals}\n\n`;
    lib.symbols.free();

    emitter.emit("tick");
}, 200);

const Page = () => (
    <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <script type="module" src="/public/datastar.js" />
            <title>Document</title>
        </head>
        <body style={{ margin: 0, padding: 0, backgroundColor: "#000" }}>
            <Main />
        </body>
    </html>
);

const Main = () => (
    <main
        data-signals={`
            const _ctx = document.querySelector('canvas').getContext('2d');
            const _img = _ctx.createImageData(${width}, ${width});
            const _data = new Uint32Array(_img.data.buffer);
            {
                _cells: [],
                _colors: new Uint32Array([
                    0xFF000000,
                    0xFF0000FF,
                    0xFF00FF00,
                    0xFFFF0000,
                ]),
                _ctx,
                _img,
                _data,
            }
        `}
        data-on-signal-change={`
            let out = 0;
            for (let i = 0; i < ${size / 4}; i++) { 
                const c = $_cells[i];
                $_data[out++] = $_colors[(c >> 0) & 0b11];
                $_data[out++] = $_colors[(c >> 2) & 0b11];
                $_data[out++] = $_colors[(c >> 4) & 0b11];
                $_data[out++] = $_colors[(c >> 6) & 0b11];
            }
            $_ctx.putImageData($_img, 0, 0);
        `}
        data-on-load="@get('/updates')"
    >
        <canvas style={{ imageRendering: "pixelated" }} width={`${width}`} height={`${width}`} />
    </main>
);

Bun.serve({
    idleTimeout: 0,
    port: 8080,
    routes: {
        "/": new Response(brotliCompressSync(await (<Page />)), {
            headers: {
                "content-encoding": "br",
                "content-type": "text/html",
            },
        }),
        "/public/datastar.js": new Response(
            brotliCompressSync(await Bun.file("public/datastar.js").bytes()),
            {
                headers: {
                    "content-encoding": "br",
                    "content-type": "text/javascript",
                },
            },
        ),
        "/updates": (req) => {
            const brotli = createBrotliCompress({
                params: {
                    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
                    [constants.BROTLI_PARAM_QUALITY]: 6,
                },
            });

            const onTick = () => {
                brotli.write(response);
                brotli.flush();
            };
            emitter.on("tick", onTick);

            req.signal.onabort = () => {
                emitter.off("tick", onTick);
                brotli.destroy();
            };

            return new Response(
                async function* () {
                    for await (const chunk of brotli) {
                        yield chunk;
                    }
                },
                {
                    headers: {
                        "content-encoding": "br",
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache",
                    },
                },
            );
        },
    },
});
