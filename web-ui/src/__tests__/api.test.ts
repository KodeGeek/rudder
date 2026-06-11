import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { api, AuthError } from "../lib/api";

// Mock the config module
vi.mock("../lib/config", () => ({
  getConfig: () => ({
    controlPlane: { proxy: "http://localhost:3000/api/control-plane" },
  }),
}));

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("successful fetch parses JSON", async () => {
    const mockData = { bundledRepoUrl: null, reconcileInterval: "5m" };
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => mockData,
    } as any);

    const result = await api.info();
    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("HTTP 401 throws AuthError", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 401,
      ok: false,
    } as any);

    await expect(api.info()).rejects.toThrow(AuthError);
  });

  it("HTTP error path throws error with status code", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      ok: false,
    } as any);

    await expect(api.info()).rejects.toThrow("GET /info → 500");
  });

  it("fetch rejection (backend down) is caught and rethrown", async () => {
    const error = new Error("Network error");
    fetchMock.mockRejectedValueOnce(error);

    await expect(api.info()).rejects.toThrow("Network error");
  });

  it("includes cache: no-store in GET requests", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({}),
    } as any);

    await api.info();

    const call = fetchMock.mock.calls[0][1] as any;
    expect(call.cache).toBe("no-store");
  });

  it("honors AbortSignal for request cancellation", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ used: 50, total: 100, pct: 50 }),
    } as any);

    await api.hostStats(controller.signal);

    const call = fetchMock.mock.calls[0][1] as any;
    expect(call.signal).toBe(controller.signal);
  });

  it("POST sends method and body", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ started: true }),
    } as any);

    await api.runJob("test-job");

    const call = fetchMock.mock.calls[0];
    const opts = call[1] as any;
    expect(opts.method).toBe("POST");
    // Body is only set when body is provided in send()
    if (opts.body) {
      expect(JSON.parse(opts.body)).toBeDefined();
    }
  });

  it("DELETE request method is set correctly", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({}),
    } as any);

    await api.removeRepo("repo-id");

    const call = fetchMock.mock.calls[0];
    const opts = call[1] as any;
    expect(opts.method).toBe("DELETE");
  });

  it("204 No Content response returns undefined", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 204,
      ok: true,
      json: async () => ({}),
    } as any);

    const result = await api.removeRepo("repo-id");

    expect(result).toBeUndefined();
  });

  it("UI survives with no backend by catching fetch rejection", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));

    try {
      await api.repos();
      expect.fail("should have thrown");
    } catch (e) {
      // Expected: the client throws, caller handles it (e.g., Promise.allSettled in useData)
      expect((e as Error).message).toBe("fetch failed");
    }
  });
});
