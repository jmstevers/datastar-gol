const std = @import("std");
const width = 5000;
const size = width * width;
const gpa = std.heap.smp_allocator;

const State = enum(u2) {
    dead = 0,
    red = 1,
    green = 2,
    blue = 3,
};

const table = blk: {
    const len = 4 * 9 * 9 * 9;
    @setEvalBranchQuota(len);

    var buf: [len]State = undefined;
    for (0..len) |i| {
        const current: State = @enumFromInt(i & 0b11);
        const red = i >> 2 & 0b111;
        const green = i >> 5 & 0b111;
        const blue = i >> 8 & 0b111;
        const sum = red + green + blue;
        if (sum == 3) {
            if (current == .dead) {
                if (red > green and red > blue) {
                    buf[i] = .red;
                } else if (green > red and green > blue) {
                    buf[i] = .green;
                } else {
                    buf[i] = .blue;
                }
            } else {
                buf[i] = current;
            }
        } else if (sum == 2 and current != .dead) {
            buf[i] = current;
        } else {
            buf[i] = .dead;
        }
    }
    break :blk buf;
};

const offsets = .{
    -width - 1,
    -width,
    -width + 1,
    -1,
    1,
    width - 1,
    width,
    width + 1,
};

var next: [size]State = undefined;
var cells: [size]State = undefined;
var packed_cells: [size / 4]u8 = undefined;
var json: []u8 = undefined;
pub export fn step() [*]u8 {
    for (0..size) |i| {
        var red: u11 = 0;
        var green: u11 = 0;
        var blue: u11 = 0;
        const base_i: i32 = @intCast(i);
        inline for (offsets) |offset| {
            const wrapped = @mod(base_i + offset, size);
            const cell = cells[@intCast(wrapped)];
            if (cell != .dead) {
                red += @intFromBool(cell == .red);
                green += @intFromBool(cell == .green);
                blue += @intFromBool(cell == .blue);
            }
        }

        const cell = @intFromEnum(cells[i]);
        const key = cell | (red << 2) | (green << 5) | (blue << 8);
        next[i] = table[key];
    }

    for (0..size / 4) |i| {
        const base = i * 4;
        packed_cells[i] = (@as(u8, @intFromEnum(cells[base])) << 0 |
            @as(u8, @intFromEnum(cells[base + 1])) << 2 |
            @as(u8, @intFromEnum(cells[base + 2])) << 4 |
            @as(u8, @intFromEnum(cells[base + 3])) << 6);
    }

    std.mem.swap([size]State, &cells, &next);

    json = std.json.stringifyAlloc(
        gpa,
        .{ ._cells = packed_cells },
        .{},
    ) catch unreachable;
    return json.ptr;
}

pub export fn free() void {
    gpa.free(json);
}

pub export fn init() void {
    var rng = std.Random.DefaultPrng.init(1738);
    const buf: []u8 = @ptrCast(@alignCast(&cells));
    rng.fill(buf);
}
