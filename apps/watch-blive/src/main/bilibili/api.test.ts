import { describe, expect, it, vi } from "vite-plus/test";
import { BilibiliApi } from "./api.ts";

describe("直播分区查询", () => {
  it.each([
    [1, "1", "0"],
    [21, "1", "21"],
  ])("分区 %i 使用正确的父子参数", async (id, parentId, childId) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { data: [{ id: 1, name: "娱乐", list: [{ id: "21", name: "日常" }] }] },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 0, data: { list: [{ roomid: 123, uid: 456, title: "聊天" }] } }),
      );
    const api = new BilibiliApi({ fetch });
    const rooms = await api.rooms(id);
    const input = fetch.mock.calls[1]![0];
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.searchParams.get("parent_area_id")).toBe(parentId);
    expect(url.searchParams.get("area_id")).toBe(childId);
    expect(rooms[0]?.roomId).toBe(123);
  });

  it("API 错误不能伪装成空候选", async () => {
    const api = new BilibiliApi({
      fetch: vi.fn().mockResolvedValue(Response.json({ code: -403, message: "拒绝访问" })),
    });
    await expect(api.rooms(1)).rejects.toThrow("-403");
  });
});
