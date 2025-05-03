// library/src/engine/consts.ts
var lol = /🖕JS_DS🚀/.source;
var DSP = lol.slice(0, 5);
var DSS = lol.slice(4);
var DATASTAR = "datastar";
var DATASTAR_REQUEST = "Datastar-Request";
var DefaultSseRetryDurationMs = 1000;
var DefaultMergeSignalsOnlyIfMissing = false;
var EventTypeMergeSignals = "datastar-merge-signals";

// library/src/utils/text.ts
var isBoolString = (str) => str.trim() === "true";
var kebab = (str) =>
    str
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([a-z])([0-9]+)/gi, "$1-$2")
        .replace(/([0-9]+)([a-z])/gi, "$1-$2")
        .toLowerCase();
var camel = (str) => kebab(str).replace(/-./g, (x) => x[1].toUpperCase());
var snake = (str) => kebab(str).replace(/-/g, "_");
var pascal = (str) => camel(str).replace(/^./, (x) => x[0].toUpperCase());
var caseFns = { kebab, snake, pascal };
function modifyCasing(str, mods) {
    for (const c of mods.get("case") || []) {
        const fn = caseFns[c];
        if (fn) str = fn(str);
    }
    return str;
}

// library/src/engine/types.ts
var DATASTAR_SIGNAL_CHANGE_EVENT = `${DATASTAR}-signal-change`;

// library/src/engine/signals.ts
var added = new Set();
var removed = new Set();
var updated = new Set();
function batch(fn) {
    added.clear();
    removed.clear();
    updated.clear();
    const result = fn();
    if (added.size || removed.size || updated.size) {
        document.dispatchEvent(
            new CustomEvent(DATASTAR_SIGNAL_CHANGE_EVENT, {
                detail: {
                    added: [...added],
                    removed: [...removed],
                    updated: [...updated],
                },
            }),
        );
    }
    return result;
}
var dependencyPaths = [];
var dependencies = new Map();
function depPaths() {
    return dependencyPaths;
}
function dep(path) {
    return dependencies.get(path);
}
function depRange(prefix) {
    const results = [];
    let left = 0;
    let right = dependencyPaths.length - 1;
    const predicate = (s) => s !== prefix && !s.startsWith(`${prefix}.`);
    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const midPath = dependencyPaths[mid];
        if (midPath < prefix) {
            left = mid + 1;
        } else if (midPath > prefix) {
            right = mid - 1;
        } else {
            let start = mid;
            do {
                const s = dependencyPaths[start];
                if (predicate(s)) break;
                start--;
            } while (start >= 0);
            let end = mid;
            do {
                const s = dependencyPaths[end];
                if (predicate(s)) break;
                end++;
            } while (end < dependencyPaths.length);
            for (let i = start + 1; i < end; i++) {
                results.push(dependencyPaths[i]);
            }
            return results;
        }
    }
    return results;
}
function setDep(path, dep2) {
    removeDeps(path);
    dependencyPaths.push(path);
    dependencies.set(path, dep2);
    dependencyPaths.sort((a, b) => b.length - a.length);
    added.add(path);
}
function setDepValue(path, value) {
    const existingSignal = dependencies.get(path);
    if (existingSignal) {
        if (!(existingSignal instanceof Signal)) {
            return;
        }
        existingSignal.value = value;
    } else {
        signal(value, path);
    }
}
function upsertIfMissing(path, defaultValue) {
    let inserted = false;
    let dep2 = dependencies.get(path);
    if (!dep2) {
        inserted = true;
        dep2 = signal(defaultValue, path);
    }
    return { dep: dep2, inserted };
}
function mergeDeps(toMerge, onlyIfMissing = false) {
    for (const [path, value] of Object.entries(toMerge)) {
        const hasKey = dependencies.has(path);
        if (hasKey && onlyIfMissing) continue;
        setDepValue(path, value);
    }
}
function removeDeps(...paths) {
    for (const path of paths) {
        const subPaths = depRange(path);
        for (const subPath of subPaths) {
            dependencies.delete(subPath);
            const index = dependencyPaths.indexOf(subPath);
            if (index > -1) {
                dependencyPaths.splice(index, 1);
            }
            removed?.add(subPath);
        }
    }
}
function json(shouldIndent = true, onlyPublic = false) {
    return JSON.stringify(nested(onlyPublic), null, shouldIndent ? 2 : 0);
}
function nested(onlyPublic, ...subPaths) {
    const filtered = new Map();
    for (const path of dependencyPaths) {
        if (onlyPublic && path.match(/^_|\._/)) {
            continue;
        }
        if (subPaths.length > 0) {
            let found = false;
            for (const subPath of subPaths) {
                if (path.startsWith(subPath)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                continue;
            }
        }
        filtered.set(path, dependencies.get(path)?.value);
    }
    const nv = unflatten(filtered);
    return nv;
}
function isPlainObject(value) {
    return Object.prototype.toString.call(value) === "[object Object]";
}
function flatten(obj, roots = [], sep = ".") {
    return Object.keys(obj).reduce((memo, prop) => {
        return Object.assign(
            {},
            memo,
            isPlainObject(obj[prop])
                ? flatten(obj[prop], roots.concat([prop]), sep)
                : { [roots.concat([prop]).join(sep)]: obj[prop] },
        );
    }, {});
}
function unflatten(obj, sep = ".") {
    const result = {};
    for (const [key, value] of obj.entries()) {
        const keys = key.split(sep);
        let current = result;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!current[k]) {
                current[k] = {};
            }
            current = current[k];
        }
        current[keys[keys.length - 1]] = value;
    }
    return result;
}
function evalRX(rxFn, dm, deps, ...args) {
    return batch(() =>
        rxFn(...args, ...deps.map((dep2, index) => (dm[index] ? dep2 : dep2.value))),
    );
}
var args = [];
var notifyBuffer = [];
var notifyIndex = 0;
var notifyBufferLength = 0;
function getter(deps, fn) {
    switch (deps.length) {
        case 0:
            return fn;
        case 1:
            return () => fn(deps[0].value);
        case 2:
            return () => fn(deps[0].value, deps[1].value);
        case 3:
            return () => fn(deps[0].value, deps[1].value, deps[2].value);
        case 4:
            return () => fn(deps[0].value, deps[1].value, deps[2].value, deps[3].value);
    }
    const len = deps.length;
    if (!args[len]) {
        args[len] = Array(len);
    }
    return () => {
        for (let i = 0; i < len; i++) {
            args[len][i] = deps[i].value;
        }
        return fn(...args[len]);
    };
}
function updateComputed(computed) {
    computed.flags &= ~((8 /* Notified */ | 16 /* Recursed */ | 224) /* Propagated */);
    const oldValue = computed.currentValue;
    const newValue = computed.getter();
    if (oldValue !== newValue) {
        computed.currentValue = newValue;
        return true;
    }
    return false;
}
function notifyEffect(effect) {
    const flags = effect.flags;
    if (
        flags & 32 /* Dirty */ ||
        (flags & 64 /* PendingComputed */ && updateDirtyFlag(effect, flags))
    ) {
        effect.flags &= ~((8 /* Notified */ | 16 /* Recursed */ | 224) /* Propagated */);
        effect.run();
    }
    return true;
}
function updateDirtyFlag(sub, flags) {
    if (checkDirty(sub.deps)) {
        sub.flags = flags | 32 /* Dirty */;
        return true;
    }
    sub.flags = flags & ~64 /* PendingComputed */;
    return false;
}
function signal(value, path) {
    return new Signal(value, path);
}

class Signal {
    currentValue;
    path;
    subs;
    subsTail;
    constructor(currentValue, path) {
        this.currentValue = currentValue;
        this.path = path;
        if (path) {
            setDep(path, this);
        }
    }
    get value() {
        return this.currentValue;
    }
    set value(value) {
        if (this.currentValue !== value) {
            this.currentValue = value;
            if (this.path) {
                updated.add(this.path);
            }
            if (this.subs) {
                let current = this.subs;
                let next = current.nextSub;
                let branchs;
                let branchDepth = 0;
                let targetFlag = 32 /* Dirty */;
                top: do {
                    const sub = current.sub;
                    const subFlags = sub.flags;
                    let shouldNotify = false;
                    if (
                        !(
                            (
                                subFlags &
                                (4 /* Tracking */ | 16 /* Recursed */ | 224)
                            ) /* Propagated */
                        )
                    ) {
                        sub.flags = subFlags | targetFlag | 8 /* Notified */;
                        shouldNotify = true;
                    } else if (subFlags & 16 /* Recursed */ && !((subFlags & 4) /* Tracking */)) {
                        sub.flags = (subFlags & ~16) /* Recursed */ | targetFlag | 8 /* Notified */;
                        shouldNotify = true;
                    } else if (!((subFlags & 224) /* Propagated */) && isValidLink(current, sub)) {
                        sub.flags = subFlags | 16 /* Recursed */ | targetFlag | 8 /* Notified */;
                        shouldNotify = !!sub.subs;
                    }
                    if (shouldNotify) {
                        const subSubs = sub.subs;
                        if (subSubs) {
                            current = subSubs;
                            if (subSubs.nextSub) {
                                branchs = { target: next, linked: branchs };
                                ++branchDepth;
                                next = current.nextSub;
                                targetFlag = 64 /* PendingComputed */;
                            } else {
                                targetFlag =
                                    subFlags & 2 /* Effect */
                                        ? 128 /* PendingEffect */
                                        : 64 /* PendingComputed */;
                            }
                            continue;
                        }
                        if (subFlags & 2 /* Effect */) {
                            notifyBuffer[notifyBufferLength++] = sub;
                        }
                    } else if (!(subFlags & (4 /* Tracking */ | targetFlag))) {
                        sub.flags = subFlags | targetFlag | 8 /* Notified */;
                        if ((subFlags & (2 /* Effect */ | 8)) /* Notified */ === 2 /* Effect */) {
                            notifyBuffer[notifyBufferLength++] = sub;
                        }
                    } else if (
                        !(subFlags & targetFlag) &&
                        subFlags & 224 /* Propagated */ &&
                        isValidLink(current, sub)
                    ) {
                        sub.flags = subFlags | targetFlag;
                    }
                    if ((current = next)) {
                        next = current.nextSub;
                        targetFlag = branchDepth ? 64 /* PendingComputed */ : 32 /* Dirty */;
                        continue;
                    }
                    while (branchDepth--) {
                        current = branchs.target;
                        branchs = branchs.linked;
                        if (current) {
                            next = current.nextSub;
                            targetFlag = branchDepth ? 64 /* PendingComputed */ : 32 /* Dirty */;
                            continue top;
                        }
                    }
                    break;
                } while (true);
                while (notifyIndex < notifyBufferLength) {
                    const effect = notifyBuffer[notifyIndex];
                    notifyBuffer[notifyIndex++] = undefined;
                    if (!notifyEffect(effect)) {
                        effect.flags &= ~8 /* Notified */;
                    }
                }
                notifyIndex = 0;
                notifyBufferLength = 0;
            }
        }
    }
}
function computed(deps, fn, path) {
    return new Computed2(deps, getter(deps, fn), path);
}

class Computed2 {
    path;
    currentValue;
    getter;
    subs;
    subsTail;
    deps;
    depsTail;
    flags = 1 /* Computed */ | 32 /* Dirty */;
    constructor(deps, fn, path) {
        this.path = path;
        this.getter = getter(deps, fn);
        if (path) {
            setDep(path, this);
        }
        for (const dep2 of deps) {
            link(dep2, this);
        }
    }
    get value() {
        const flags = this.flags;
        if (flags & (64 /* PendingComputed */ | 32) /* Dirty */) {
            if (flags & 32 /* Dirty */ || checkDirty(this.deps)) {
                if (updateComputed(this)) {
                    const subs = this.subs;
                    if (subs) {
                        shallowPropagate(subs);
                    }
                }
            } else {
                this.flags = flags & ~64 /* PendingComputed */;
            }
        }
        return this.currentValue;
    }
}
function effect(deps, fn) {
    const e = new Effect(deps, fn);
    return () => e.dispose();
}

class Effect {
    deps;
    depsTail;
    flags = 2 /* Effect */;
    run;
    constructor(deps, fn) {
        for (const dep2 of deps) {
            link(dep2, this);
        }
        this.run = getter(deps, fn);
        this.run();
    }
    dispose() {
        this.depsTail = undefined;
        this.flags &= ~((8 /* Notified */ | 16 /* Recursed */ | 224) /* Propagated */);
        if (this.deps) {
            let link = this.deps;
            do {
                const dep2 = link.dep;
                const nextDep = link.nextDep;
                const nextSub = link.nextSub;
                const prevSub = link.prevSub;
                if (nextSub) {
                    nextSub.prevSub = prevSub;
                } else {
                    dep2.subsTail = prevSub;
                }
                if (prevSub) {
                    prevSub.nextSub = nextSub;
                } else {
                    dep2.subs = nextSub;
                }
                if (!dep2.subs && "deps" in dep2) {
                    const depFlags = dep2.flags;
                    if (!((depFlags & 32) /* Dirty */)) {
                        dep2.flags = depFlags | 32 /* Dirty */;
                    }
                    const depDeps = dep2.deps;
                    if (depDeps) {
                        link = depDeps;
                        dep2.depsTail.nextDep = nextDep;
                        dep2.deps = undefined;
                        dep2.depsTail = undefined;
                        continue;
                    }
                }
                link = nextDep;
            } while (link);
            this.deps = undefined;
        }
    }
}
function link(dep2, sub) {
    const currentDep = sub.depsTail;
    if (currentDep && currentDep.dep === dep2) {
        return;
    }
    const nextDep = currentDep ? currentDep.nextDep : sub.deps;
    if (nextDep && nextDep.dep === dep2) {
        sub.depsTail = nextDep;
        return;
    }
    const depLastSub = dep2.subsTail;
    if (depLastSub && depLastSub.sub === sub && isValidLink(depLastSub, sub)) {
        return;
    }
    const newLink = {
        dep: dep2,
        sub,
        nextDep,
        prevSub: undefined,
        nextSub: undefined,
    };
    if (!currentDep) {
        sub.deps = newLink;
    } else {
        currentDep.nextDep = newLink;
    }
    if (!dep2.subs) {
        dep2.subs = newLink;
    } else {
        const oldTail = dep2.subsTail;
        newLink.prevSub = oldTail;
        oldTail.nextSub = newLink;
    }
    sub.depsTail = newLink;
    dep2.subsTail = newLink;
    return newLink;
}
function checkDirty(current) {
    let prevLinks;
    let checkDepth = 0;
    let dirty;
    top: do {
        dirty = false;
        const dep2 = current.dep;
        if (current.sub.flags & 32 /* Dirty */) {
            dirty = true;
        } else if ("flags" in dep2) {
            const depFlags = dep2.flags;
            if (
                (depFlags & (1 /* Computed */ | 32)) /* Dirty */ ===
                (1 /* Computed */ | 32) /* Dirty */
            ) {
                if (updateComputed(dep2)) {
                    const subs = dep2.subs;
                    if (subs.nextSub) {
                        shallowPropagate(subs);
                    }
                    dirty = true;
                }
            } else if (
                (depFlags & (1 /* Computed */ | 64)) /* PendingComputed */ ===
                (1 /* Computed */ | 64) /* PendingComputed */
            ) {
                if (current.nextSub || current.prevSub) {
                    prevLinks = { target: current, linked: prevLinks };
                }
                current = dep2.deps;
                ++checkDepth;
                continue;
            }
        }
        if (!dirty && current.nextDep) {
            current = current.nextDep;
            continue;
        }
        while (checkDepth) {
            --checkDepth;
            const sub = current.sub;
            const firstSub = sub.subs;
            if (dirty) {
                if (updateComputed(sub)) {
                    if (firstSub.nextSub) {
                        current = prevLinks.target;
                        prevLinks = prevLinks.linked;
                        shallowPropagate(firstSub);
                    } else {
                        current = firstSub;
                    }
                    continue;
                }
            } else {
                sub.flags &= ~64 /* PendingComputed */;
            }
            if (firstSub.nextSub) {
                current = prevLinks.target;
                prevLinks = prevLinks.linked;
            } else {
                current = firstSub;
            }
            if (current.nextDep) {
                current = current.nextDep;
                continue top;
            }
            dirty = false;
        }
        return dirty;
    } while (true);
}
function shallowPropagate(link2) {
    do {
        const sub = link2.sub;
        const subFlags = sub.flags;
        if ((subFlags & (64 /* PendingComputed */ | 32)) /* Dirty */ === 64 /* PendingComputed */) {
            sub.flags = subFlags | 32 /* Dirty */ | 8 /* Notified */;
            if ((subFlags & (2 /* Effect */ | 8)) /* Notified */ === 2 /* Effect */) {
                notifyBuffer[notifyBufferLength++] = sub;
            }
        }
        link2 = link2.nextSub;
    } while (link2);
}
function isValidLink(checkLink, sub) {
    const depsTail = sub.depsTail;
    if (depsTail) {
        let link2 = sub.deps;
        do {
            if (link2 === checkLink) {
                return true;
            }
            if (link2 === depsTail) {
                break;
            }
            link2 = link2.nextDep;
        } while (link2);
    }
    return false;
}

// library/src/plugins/core/attributes/signals.ts
var Signals = {
    type: "attribute",
    name: "signals",
    returnValReq: true,
    onLoad: (ctx) => {
        const { key, mods, value, genRX, evalRX: evalRX2, batch: batch2 } = ctx;
        const { deps, dm, rxFn } = genRX();
        const ifMissing = mods.has("ifmissing");
        if (key !== "") {
            const k = modifyCasing(key, mods);
            const v = value === "" ? value : evalRX2(rxFn, dm, deps);
            batch2(() => {
                if (ifMissing) {
                    upsertIfMissing(k, v);
                } else {
                    setDepValue(k, v);
                }
            });
        } else {
            const nv = evalRX2(rxFn, dm, deps);
            batch2(() => {
                mergeDeps(nv, ifMissing);
            });
        }
    },
};

// library/src/utils/dom.ts
function isHTMLOrSVG(el) {
    return el instanceof HTMLElement || el instanceof SVGElement;
}
function walkDOM(element, callback) {
    const ignore = alias ? `data-${alias}-ignore` : "data-ignore";
    const ignoreSelf = `${ignore}__self`;
    if (!isHTMLOrSVG(element) || element.closest(`[${ignore}]`)) {
        return;
    }
    const iter = document.createTreeWalker(element, 1);
    while (element) {
        if (isHTMLOrSVG(element)) {
            if (element.hasAttribute(ignore)) {
                element = iter.nextSibling();
                continue;
            }
            if (!element.hasAttribute(ignoreSelf)) {
                callback(element);
            }
        }
        element = iter.nextNode();
    }
}

// library/src/engine/errors.ts
var url = "https://data-star.dev/errors";
function dserr(type, reason, metadata = {}) {
    const e = new Error();
    e.name = `${DATASTAR} ${type} error`;
    const r = snake(reason);
    const q = new URLSearchParams({
        metadata: JSON.stringify(metadata),
    }).toString();
    const c = JSON.stringify(metadata, null, 2);
    e.message = `${reason}
More info: ${url}/${type}/${r}?${q}
Context: ${c}`;
    return e;
}
function initErr(reason, ctx, metadata = {}) {
    const errCtx = {
        plugin: {
            name: ctx.plugin.name,
            type: ctx.plugin.type,
        },
    };
    return dserr("init", reason, Object.assign(errCtx, metadata));
}
function runtimeErr(reason, ctx, metadata = {}) {
    const errCtx = {
        plugin: {
            name: ctx.plugin.name,
            type: ctx.plugin.type,
        },
        element: {
            id: ctx.el.id,
            tag: ctx.el.tagName,
        },
        expression: {
            rawKey: ctx.rawKey,
            key: ctx.key,
            value: ctx.value,
            validSignals: depPaths(),
            fnContent: ctx.fnContent,
        },
    };
    return dserr("runtime", reason, Object.assign(errCtx, metadata));
}

// library/src/engine/engine.ts
var actions = {};
var plugins = [];
var removals = new Map();
var mutationObserver = null;
var alias = "";
function setAlias(value) {
    alias = value;
}
function load(...pluginsToLoad) {
    for (const plugin of pluginsToLoad) {
        const ctx = {
            plugin,
            actions,
            removals,
            applyToElement,
            batch,
            signal,
            computed,
            effect,
        };
        const type = plugin.type;
        if (type === "action") {
            actions[plugin.name] = plugin;
        } else if (type === "attribute") {
            plugins.push(plugin);
            plugin.onGlobalInit?.(ctx);
        } else if (type === "watcher") {
            plugin.onGlobalInit?.(ctx);
        } else {
            throw initErr("InvalidPluginType", ctx);
        }
    }
    plugins.sort((a, b) => {
        const lenDiff = b.name.length - a.name.length;
        if (lenDiff !== 0) return lenDiff;
        return a.name.localeCompare(b.name);
    });
}
function apply() {
    queueMicrotask(() => {
        walkDOM(document.documentElement, applyToElement);
        if (!mutationObserver) {
            mutationObserver = new MutationObserver(observe);
            mutationObserver.observe(document.body, {
                subtree: true,
                childList: true,
                attributes: true,
            });
        }
    });
}
function observe(mutations) {
    const pending = new Set();
    for (const { target, type, addedNodes, removedNodes } of mutations) {
        switch (type) {
            case "childList":
                {
                    for (const node of removedNodes) {
                        walkDOM(node, (el) => {
                            const elCleanups = removals.get(el);
                            if (removals.delete(el)) {
                                for (const cleanup of elCleanups.values()) {
                                    cleanup();
                                }
                                elCleanups.clear();
                            }
                        });
                    }
                    for (const node of addedNodes) {
                        walkDOM(node, (el) => pending.add(el));
                    }
                }
                break;
            case "attributes": {
                if (
                    !isHTMLOrSVG(target) ||
                    target.closest(`[${alias ? `data-${alias}-ignore` : "data-ignore"}]`)
                ) {
                    continue;
                }
                pending.add(target);
                break;
            }
        }
    }
    const toApply = Array.from(pending);
    toApply.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    for (const el of toApply) {
        applyToElement(el);
    }
}
function djb2(str) {
    let hash = 5831;
    let i = str.length;
    while (i--) {
        hash += (hash << 5) + str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
function applyToElement(el) {
    const toApply = [];
    const elCleanups = removals.get(el) || new Map();
    const toCleanup = new Map(elCleanups);
    for (const [key, value] of Object.entries(el.dataset)) {
        if (!key.startsWith(alias)) {
            continue;
        }
        const hash = djb2(`${key}${value}`);
        if (!toCleanup.delete(hash)) {
            toApply.push({ key, value, hash });
        }
    }
    for (const [hash, cleanup] of toCleanup) {
        cleanup();
        elCleanups.delete(hash);
    }
    for (const { key, value, hash } of toApply) {
        const cleanup = applyAttributePlugin(el, key, value);
        if (cleanup) {
            elCleanups.set(hash, cleanup);
        }
    }
    if (elCleanups.size) {
        removals.set(el, elCleanups);
    }
}
function applyAttributePlugin(el, datasetKey, value) {
    const rawKey = camel(datasetKey.slice(alias.length));
    const plugin = plugins.find((p) => RegExp(`^${p.name}([A-Z]|_|$)`).test(rawKey));
    if (!plugin) return;
    let [key, ...rawModifiers] = rawKey.slice(plugin.name.length).split(/\_\_+/);
    const hasKey = !!key;
    if (hasKey) {
        key = camel(key);
    }
    const hasValue = !!value;
    const ctx = {
        applyToElement,
        actions,
        removals,
        genRX: () => genRX(ctx, ...(plugin.argNames || [])),
        plugin,
        el,
        rawKey,
        key,
        value,
        mods: new Map(),
        batch,
        signal,
        computed,
        effect,
        evalRX,
    };
    const keyReq = plugin.keyReq || "allowed";
    if (hasKey) {
        if (keyReq === "denied") {
            throw runtimeErr(`${plugin.name}KeyNotAllowed`, ctx);
        }
    } else if (keyReq === "must") {
        throw runtimeErr(`${plugin.name}KeyRequired`, ctx);
    }
    const valReq = plugin.valReq || "allowed";
    if (hasValue) {
        if (valReq === "denied") {
            throw runtimeErr(`${plugin.name}ValueNotAllowed`, ctx);
        }
    } else if (valReq === "must") {
        throw runtimeErr(`${plugin.name}ValueRequired`, ctx);
    }
    if (keyReq === "exclusive" || valReq === "exclusive") {
        if (hasKey && hasValue) {
            throw runtimeErr(`${plugin.name}KeyAndValueProvided`, ctx);
        }
        if (!hasKey && !hasValue) {
            throw runtimeErr(`${plugin.name}KeyOrValueRequired`, ctx);
        }
    }
    for (const rawMod of rawModifiers) {
        const [label, ...mod] = rawMod.split(".");
        ctx.mods.set(camel(label), new Set(mod.map((t) => t.toLowerCase())));
    }
    return plugin.onLoad(ctx) || (() => {});
}
function genRX(ctx, ...argNames) {
    const dm = [];
    const dependencySet = new Set();
    let expr = "";
    if (ctx.plugin.returnValReq) {
        const statementRe =
            /(\/(\\\/|[^\/])*\/|"(\\"|[^\"])*"|'(\\'|[^'])*'|`(\\`|[^`])*`|\(\s*((function)\s*\(\s*\)|(\(\s*\))\s*=>)\s*(?:\{[\s\S]*?\}|[^;)\{]*)\s*\)\s*\(\s*\)|[^;])+/gm;
        const statements = ctx.value.trim().match(statementRe);
        if (statements) {
            const lastIdx = statements.length - 1;
            const last = statements[lastIdx].trim();
            if (!last.startsWith("return")) {
                statements[lastIdx] = `return (${last});`;
            }
            expr = statements.join(`;
`);
        }
    } else {
        expr = ctx.value.trim();
    }
    const escaped = new Map();
    const escapeRe = RegExp(`(?:${DSP})(.*?)(?:${DSS})`, "gm");
    for (const match of expr.matchAll(escapeRe)) {
        const k = match[1];
        const v = `dsEscaped${djb2(k)}`;
        escaped.set(v, k);
        expr = expr.replace(DSP + k + DSS, v);
    }
    const nameGen = (prefix, name2) => {
        return `${prefix}${snake(name2).replaceAll(/\./g, "_")}`;
    };
    const argsDependenciesActionsNames = new Set(argNames);
    const dependencyPaths2 = depPaths();
    if (dependencyPaths2.length) {
        const pattern = dependencyPaths2.join("|");
        const signalsWithAssignedValuesRe = RegExp(
            `\\$(${pattern})(\\s*[+&^\\/*|-]?=[^=]|\\+\\+|--)`,
            "gm",
        );
        const signalsWithAssignedValuesMatches = [...expr.matchAll(signalsWithAssignedValuesRe)];
        const updateUserExpression = (match, name2, suffix = "") => {
            const re = RegExp(`\\$${match[1]}(?!\\w)`, "gm");
            expr = expr.replaceAll(re, name2 + suffix);
        };
        if (signalsWithAssignedValuesMatches.length) {
            const signalMutationPrefix = `${DATASTAR}Mut_`;
            const mutableDependencies = new Set();
            for (const match of signalsWithAssignedValuesMatches) {
                const depName = match[1];
                const d = dep(depName);
                const name2 = nameGen(signalMutationPrefix, depName);
                if (d && !mutableDependencies.has(d)) {
                    dependencySet.add(d);
                    mutableDependencies.add(d);
                    dm.push(true);
                    argsDependenciesActionsNames.add(name2);
                }
                updateUserExpression(match, name2, ".value");
            }
        }
        const pureDependencyRe = RegExp(`\\$(${pattern})(\\W|$)`, "gm");
        const allPureDependenciesMatches = [...expr.matchAll(pureDependencyRe)];
        if (allPureDependenciesMatches.length) {
            const pureDependencyPrefix = `${DATASTAR}Pure_`;
            const pureDependencies = new Set();
            for (const match of allPureDependenciesMatches) {
                const pureDepName = match[1];
                const pureDep = dep(pureDepName);
                const name2 = nameGen(pureDependencyPrefix, pureDepName);
                if (pureDep && !pureDependencies.has(pureDep)) {
                    dependencySet.add(pureDep);
                    pureDependencies.add(pureDep);
                    dm.push(false);
                    argsDependenciesActionsNames.add(name2);
                }
                updateUserExpression(match, name2);
            }
        }
    }
    const actionsCalled = new Set();
    const actionsRe = RegExp(`@(${Object.keys(actions).join("|")})\\(`, "gm");
    const actionMatches = [...expr.matchAll(actionsRe)];
    const actionFns = new Set();
    if (actionMatches.length) {
        const actionPrefix = `${DATASTAR}Act_`;
        for (const match of actionMatches) {
            const actionName = match[1];
            const action = actions[actionName];
            if (!action) {
                continue;
            }
            actionsCalled.add(actionName);
            const name2 = nameGen(actionPrefix, actionName);
            argsDependenciesActionsNames.add(name2);
            expr = expr.replace(`@${actionName}(`, `${name2}(`);
            actionFns.add((...args2) => action.fn(ctx, ...args2));
        }
    }
    for (const [k, v] of escaped) {
        expr = expr.replace(k, v);
    }
    ctx.fnContent = expr;
    try {
        const fn = Function("el", ...argsDependenciesActionsNames, expr);
        return {
            dm,
            deps: [...dependencySet],
            rxFn: (...argsAndDependencyValues) => {
                try {
                    return fn(ctx.el, ...argsAndDependencyValues, ...actionFns);
                } catch (e) {
                    throw runtimeErr("ExecuteExpression", ctx, {
                        error: e.message,
                    });
                }
            },
        };
    } catch (error) {
        throw runtimeErr("GenerateExpression", ctx, {
            error: error.message,
        });
    }
}

// library/src/plugins/framework/backend/shared.ts
var DATASTAR_SSE_EVENT = `${DATASTAR}-sse`;
var STARTED = "started";
var FINISHED = "finished";
var ERROR = "error";
var RETRYING = "retrying";
var RETRIES_FAILED = "retrying";
function datastarSSEEventWatcher(eventType, fn) {
    document.addEventListener(DATASTAR_SSE_EVENT, (event) => {
        if (event.detail.type !== eventType) {
            return;
        }
        const { argsRaw } = event.detail;
        fn(argsRaw);
    });
}

// library/src/plugins/framework/backend/actions/sse.ts
function dispatchSSE(type, el, argsRaw) {
    document.dispatchEvent(
        new CustomEvent(DATASTAR_SSE_EVENT, {
            detail: { type, el, argsRaw },
        }),
    );
}
var isWrongContent = (err) => `${err}`.includes("text/event-stream");
var shouldSendUsingQueryParams = (method) => method === "GET";
var sse = async (ctx, method, url2, args2) => {
    const { el, evt } = ctx;
    const {
        headers: userHeaders,
        contentType,
        includeLocal,
        excludeSignals,
        selector,
        openWhenHidden,
        retryInterval,
        retryScaler,
        retryMaxWaitMs,
        retryMaxCount,
        abort,
    } = Object.assign(
        {
            headers: {},
            contentType: "json",
            includeLocal: false,
            excludeSignals: false,
            selector: null,
            openWhenHidden: false,
            retryInterval: DefaultSseRetryDurationMs,
            retryScaler: 2,
            retryMaxWaitMs: 30000,
            retryMaxCount: 10,
            abort: undefined,
        },
        args2,
    );
    const action = method.toLowerCase();
    let cleanupFn = () => {};
    try {
        if (!url2?.length) {
            throw runtimeErr("SseNoUrlProvided", ctx, { action });
        }
        const initialHeaders = {};
        initialHeaders[DATASTAR_REQUEST] = true;
        if (contentType === "json") {
            initialHeaders["Content-Type"] = "application/json";
        }
        const headers = Object.assign({}, initialHeaders, userHeaders);
        const req = {
            method,
            headers,
            openWhenHidden,
            retryInterval,
            retryScaler,
            retryMaxWaitMs,
            retryMaxCount,
            signal: abort,
            onopen: async (response) => {
                if (response.status >= 400) {
                    const status = response.status.toString();
                    dispatchSSE(ERROR, el, { status });
                }
            },
            onmessage: (evt2) => {
                if (!evt2.event.startsWith(DATASTAR)) {
                    return;
                }
                const type = evt2.event;
                const argsRawLines = {};
                const lines = evt2.data.split(`
`);
                for (const line of lines) {
                    const colonIndex = line.indexOf(" ");
                    const key = line.slice(0, colonIndex);
                    let argLines = argsRawLines[key];
                    if (!argLines) {
                        argLines = [];
                        argsRawLines[key] = argLines;
                    }
                    const value = line.slice(colonIndex + 1);
                    argLines.push(value);
                }
                const argsRaw = {};
                for (const [key, lines2] of Object.entries(argsRawLines)) {
                    argsRaw[key] = lines2.join(`
`);
                }
                dispatchSSE(type, el, argsRaw);
            },
            onerror: (error) => {
                if (isWrongContent(error)) {
                    throw runtimeErr("InvalidContentType", ctx, { url: url2 });
                }
                if (error) {
                    console.error(error.message);
                    dispatchSSE(RETRYING, el, { message: error.message });
                }
            },
        };
        const urlInstance = new URL(url2, window.location.href);
        const queryParams = new URLSearchParams(urlInstance.search);
        if (contentType === "json") {
            if (!excludeSignals) {
                const res = json(false, !includeLocal);
                if (shouldSendUsingQueryParams(method)) {
                    queryParams.set(DATASTAR, res);
                } else {
                    req.body = res;
                }
            }
        } else if (contentType === "form") {
            const formEl = selector ? document.querySelector(selector) : el.closest("form");
            if (formEl === null) {
                if (selector) {
                    throw runtimeErr("SseFormNotFound", ctx, { action, selector });
                }
                throw runtimeErr("SseClosestFormNotFound", ctx, { action });
            }
            if (!formEl.checkValidity()) {
                formEl.reportValidity();
                cleanupFn();
                return;
            }
            const formData = new FormData(formEl);
            let submitter = el;
            if (el === formEl) {
                if (evt instanceof SubmitEvent) {
                    submitter = evt.submitter;
                }
            } else {
                const preventDefault = (evt2) => evt2.preventDefault();
                formEl.addEventListener("submit", preventDefault);
                cleanupFn = () => formEl.removeEventListener("submit", preventDefault);
            }
            if (submitter instanceof HTMLButtonElement) {
                const name2 = submitter.getAttribute("name");
                if (name2) {
                    formData.append(name2, submitter.value);
                }
            }
            const multipart = formEl.getAttribute("enctype") === "multipart/form-data";
            if (!multipart) {
                headers["Content-Type"] = "application/x-www-form-urlencoded";
            }
            const formParams = new URLSearchParams(formData);
            if (shouldSendUsingQueryParams(method)) {
                for (const [key, value] of formParams) {
                    queryParams.append(key, value);
                }
            } else if (multipart) {
                req.body = formData;
            } else {
                req.body = formParams;
            }
        } else {
            throw runtimeErr("SseInvalidContentType", ctx, { action, contentType });
        }
        dispatchSSE(STARTED, el, {});
        urlInstance.search = queryParams.toString();
        try {
            await fetchEventSource(urlInstance.toString(), el, req);
        } catch (error) {
            if (!isWrongContent(error)) {
                throw runtimeErr("SseFetchFailed", ctx, { method, url: url2, error });
            }
        }
    } finally {
        dispatchSSE(FINISHED, el, {});
        cleanupFn();
    }
};
async function getBytes(stream, onChunk) {
    const reader = stream.getReader();
    let result;
    result = await reader.read();
    while (!result.done) {
        onChunk(result.value);
        result = await reader.read();
    }
}
function getLines(onLine) {
    let buffer;
    let position;
    let fieldLength;
    let discardTrailingNewline = false;
    return function onChunk(arr) {
        if (buffer === undefined) {
            buffer = arr;
            position = 0;
            fieldLength = -1;
        } else {
            buffer = concat(buffer, arr);
        }
        const bufLength = buffer.length;
        let lineStart = 0;
        while (position < bufLength) {
            if (discardTrailingNewline) {
                if (buffer[position] === 10 /* NewLine */) {
                    lineStart = ++position;
                }
                discardTrailingNewline = false;
            }
            let lineEnd = -1;
            for (; position < bufLength && lineEnd === -1; ++position) {
                switch (buffer[position]) {
                    case 58 /* Colon */:
                        if (fieldLength === -1) {
                            fieldLength = position - lineStart;
                        }
                        break;
                    case 13 /* CarriageReturn */:
                        discardTrailingNewline = true;
                    case 10 /* NewLine */:
                        lineEnd = position;
                        break;
                }
            }
            if (lineEnd === -1) {
                break;
            }
            onLine(buffer.subarray(lineStart, lineEnd), fieldLength);
            lineStart = position;
            fieldLength = -1;
        }
        if (lineStart === bufLength) {
            buffer = undefined;
        } else if (lineStart !== 0) {
            buffer = buffer.subarray(lineStart);
            position -= lineStart;
        }
    };
}
function getMessages(onId, onRetry, onMessage) {
    let message = newMessage();
    const decoder = new TextDecoder();
    return function onLine(line, fieldLength) {
        if (line.length === 0) {
            onMessage?.(message);
            message = newMessage();
        } else if (fieldLength > 0) {
            const field = decoder.decode(line.subarray(0, fieldLength));
            const valueOffset = fieldLength + (line[fieldLength + 1] === 32 /* Space */ ? 2 : 1);
            const value = decoder.decode(line.subarray(valueOffset));
            switch (field) {
                case "data":
                    message.data = message.data
                        ? `${message.data}
${value}`
                        : value;
                    break;
                case "event":
                    message.event = value;
                    break;
                case "id":
                    onId((message.id = value));
                    break;
                case "retry": {
                    const retry = Number.parseInt(value, 10);
                    if (!Number.isNaN(retry)) {
                        onRetry((message.retry = retry));
                    }
                    break;
                }
            }
        }
    };
}
function concat(a, b) {
    const res = new Uint8Array(a.length + b.length);
    res.set(a);
    res.set(b, a.length);
    return res;
}
function newMessage() {
    return { data: "", event: "", id: "", retry: undefined };
}
var EventStreamContentType = "text/event-stream";
var LastEventId = "last-event-id";
function fetchEventSource(
    input,
    el,
    {
        signal: inputSignal,
        headers: inputHeaders,
        onopen: inputOnOpen,
        onmessage,
        onclose,
        onerror,
        openWhenHidden,
        fetch: inputFetch,
        retryInterval = 1000,
        retryScaler = 2,
        retryMaxWaitMs = 30000,
        retryMaxCount = 10,
        ...rest
    },
) {
    return new Promise((resolve, reject) => {
        let retries = 0;
        const headers = { ...inputHeaders };
        if (!headers.accept) {
            headers.accept = EventStreamContentType;
        }
        let curRequestController;
        function onVisibilityChange() {
            curRequestController.abort();
            if (!document.hidden) {
                create();
            }
        }
        if (!openWhenHidden) {
            document.addEventListener("visibilitychange", onVisibilityChange);
        }
        let retryTimer = 0;
        function dispose() {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            window.clearTimeout(retryTimer);
            curRequestController.abort();
        }
        inputSignal?.addEventListener("abort", () => {
            dispose();
            resolve();
        });
        const fetch = inputFetch ?? window.fetch;
        const onopen = inputOnOpen ?? function defaultOnOpen() {};
        async function create() {
            curRequestController = new AbortController();
            try {
                const response = await fetch(input, {
                    ...rest,
                    headers,
                    signal: curRequestController.signal,
                });
                await onopen(response);
                await getBytes(
                    response.body,
                    getLines(
                        getMessages(
                            (id) => {
                                if (id) {
                                    headers[LastEventId] = id;
                                } else {
                                    delete headers[LastEventId];
                                }
                            },
                            (retry) => {
                                retryInterval = retry;
                            },
                            onmessage,
                        ),
                    ),
                );
                onclose?.();
                dispose();
                resolve();
            } catch (err) {
                if (!curRequestController.signal.aborted) {
                    try {
                        const interval = onerror?.(err) ?? retryInterval;
                        window.clearTimeout(retryTimer);
                        retryTimer = window.setTimeout(create, interval);
                        retryInterval *= retryScaler;
                        retryInterval = Math.min(retryInterval, retryMaxWaitMs);
                        retries++;
                        if (retries >= retryMaxCount) {
                            dispatchSSE(RETRIES_FAILED, el, {});
                            dispose();
                            reject("Max retries reached.");
                        } else {
                            console.error(
                                `Datastar failed to reach ${input.toString()} retrying in ${interval}ms.`,
                            );
                        }
                    } catch (innerErr) {
                        dispose();
                        reject(innerErr);
                    }
                }
            }
        }
        create();
    });
}

// library/src/plugins/framework/backend/actions/get.ts
var GET = {
    type: "action",
    name: "get",
    fn: async (ctx, url2, args2) => {
        return sse(ctx, "GET", url2, { ...args2 });
    },
};

// library/src/utils/view-transtions.ts
var docWithViewTransitionAPI = document;
var supportsViewTransitions = !!docWithViewTransitionAPI.startViewTransition;
function modifyViewTransition(callback, mods) {
    if (mods.has("viewtransition") && supportsViewTransitions) {
        const cb = callback;
        callback = (...args2) => document.startViewTransition(() => cb(...args2));
    }
    return callback;
}

// library/src/plugins/framework/backend/watchers/mergeSignals.ts
var MergeSignals = {
    type: "watcher",
    name: EventTypeMergeSignals,
    onGlobalInit: async ({ batch: batch2 }) => {
        datastarSSEEventWatcher(
            EventTypeMergeSignals,
            ({
                signals: raw = "{}",
                onlyIfMissing: onlyIfMissingRaw = `${DefaultMergeSignalsOnlyIfMissing}`,
            }) => {
                const onlyIfMissing = isBoolString(onlyIfMissingRaw);
                const rawObj = JSON.parse(raw);
                batch2(() => mergeDeps(rawObj, onlyIfMissing));
            },
        );
    },
};

// library/src/utils/tags.ts
function tagToMs(args2) {
    if (!args2 || args2.size <= 0) return 0;
    for (const arg of args2) {
        if (arg.endsWith("ms")) {
            return Number(arg.replace("ms", ""));
        }
        if (arg.endsWith("s")) {
            return Number(arg.replace("s", "")) * 1000;
        }
        try {
            return Number.parseFloat(arg);
        } catch (e) {}
    }
    return 0;
}

// library/src/utils/timing.ts
function delay(callback, wait) {
    return (...args2) => {
        setTimeout(() => {
            callback(...args2);
        }, wait);
    };
}

// library/src/plugins/framework/attributes/onLoad.ts
var once2 = new WeakSet();
var OnLoad = {
    type: "attribute",
    name: "onLoad",
    keyReq: "denied",
    valReq: "must",
    onLoad: ({ el, mods, genRX: genRX2, evalRX: evalRX2 }) => {
        const { dm, deps, rxFn } = genRX2();
        let callback = () => evalRX2(rxFn, dm, deps);
        callback = modifyViewTransition(callback, mods);
        let wait = 0;
        const delayArgs = mods.get("delay");
        if (delayArgs) {
            wait = tagToMs(delayArgs);
        }
        callback = delay(callback, wait);
        if (!once2.has(el)) {
            callback();
        }
        if (mods.has("once")) {
            once2.add(el);
        }
        return () => {
            if (!mods.has("once")) {
                once2.delete(el);
            }
        };
    },
};

// library/src/plugins/framework/attributes/onSignalChange.ts
var OnSignalChange = {
    type: "attribute",
    name: "onSignalChange",
    valReq: "must",
    argNames: ["evt"],
    onLoad: ({ genRX: genRX2 }) => {
        const { deps, rxFn } = genRX2();
        const signalFn = (evt) => {
            rxFn(evt, ...deps.map((dep) => dep.value));
        };
        document.addEventListener(DATASTAR_SIGNAL_CHANGE_EVENT, signalFn);
        return () => {
            document.removeEventListener(DATASTAR_SIGNAL_CHANGE_EVENT, signalFn);
        };
    },
};

load(Signals, GET, MergeSignals, OnLoad, OnSignalChange);
apply();
export { setAlias, load, apply };
