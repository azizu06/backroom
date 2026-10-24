import { afterEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
    init: vi.fn(),
    on: vi.fn(),
    getInput: vi.fn(),
    pushData: vi.fn(),
    exit: vi.fn(),
}));
vi.mock('apify', () => ({ Actor: sdk, log: { info: vi.fn() } }));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.resetModules();
});

it('probes the demo website and writes one sourced dataset record through the Actor SDK', async () => {
    sdk.getInput.mockResolvedValue({ companyName: "Kim's Island", website: 'https://kimsislandsi.com/' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await import('../src/main.js');

    expect(sdk.init).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://kimsislandsi.com/', {
        method: 'GET', redirect: 'follow', signal: expect.any(AbortSignal),
    });
    expect(sdk.pushData).toHaveBeenCalledExactlyOnceWith({ signals: [{
        type: 'website_reachable', value: true, sourceUrl: 'https://kimsislandsi.com/',
        observedAt: expect.any(String),
    }] });
    expect(Number.isFinite(Date.parse(sdk.pushData.mock.calls[0][0].signals[0].observedAt))).toBe(true);
    expect(sdk.exit).toHaveBeenCalledOnce();
    expect(sdk.on).toHaveBeenCalledWith('aborting', expect.any(Function));
});

it('keeps missing evidence empty when the website is offline instead of inventing a healthy signal', async () => {
    sdk.getInput.mockResolvedValue({ companyName: "Kim's Island", website: 'https://kimsislandsi.com/' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await import('../src/main.js');

    expect(sdk.pushData).toHaveBeenCalledExactlyOnceWith({ signals: [] });
    expect(sdk.exit).toHaveBeenCalledOnce();
});
