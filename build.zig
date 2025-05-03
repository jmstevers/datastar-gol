const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const gol = b.addSharedLibrary(.{
        .name = "gol",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/gol.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    b.installArtifact(gol);
}
