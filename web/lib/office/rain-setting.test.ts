import { afterEach, expect, it, vi } from 'vitest';
import { rainSetting } from './rain-setting';

afterEach(() => rainSetting.setEnabled(false));
it('shares a default-off setting and notifies subscribers only when changed', () => {
  expect(rainSetting.getSnapshot()).toBe(false);
  const listener = vi.fn();
  const unsubscribe = rainSetting.subscribe(listener);
  rainSetting.setEnabled(true);
  expect(rainSetting.getSnapshot()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  rainSetting.setEnabled(true);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  rainSetting.setEnabled(false);
  expect(listener).toHaveBeenCalledTimes(1);
});
