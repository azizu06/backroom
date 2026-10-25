import { test, expect } from '@playwright/test';
import { STORY_CHAPTERS, storyCameraPose } from '../lib/office/story';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`judge tour visits every stop and Skip retains first person (${reducedMotion})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion });
    await page.goto('/office');
    await page.getByRole('button', { name: 'Take the tour', exact: true }).click();
    const story = page.getByRole('complementary', { name: 'Judge story mode' });
    const camera = page.getByTestId('story-camera');
    await expect(page.getByLabel('Office view')).toHaveValue('play');
    await expect(story.locator('.story-disclaimer')).toContainText('Scripted walkthrough · illustration, not recorded decisions');
    await story.getByRole('button', { name: 'Pause', exact: true }).click();
    for (const [index, chapter] of STORY_CHAPTERS.entries()) {
      await expect(story.getByRole('heading')).toHaveText(chapter.title);
      if (chapter.handoff) await expect(story.getByRole('img', { name: /Scripted evidence folder handoff/ })).toBeVisible();
      await expect(camera).toHaveAttribute('data-story-anchor', chapter.anchor);
      await expect(camera).toHaveAttribute('data-story-moving', 'false', { timeout: reducedMotion === 'reduce' ? 600 : 3000 });
      const pose = storyCameraPose(chapter.anchor);
      await expect(camera).toHaveAttribute('data-player-x', pose.position[0].toFixed(3));
      await expect(camera).toHaveAttribute('data-player-z', pose.position[2].toFixed(3));
      if (index < STORY_CHAPTERS.length - 1) {
        if (index === 0) await page.keyboard.press('ArrowRight');
        else await story.getByRole('button', { name: 'Next', exact: true }).click();
      }
    }
    await story.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(story.getByRole('heading')).toHaveText('A human decides');
    await page.keyboard.press('ArrowLeft');
    await expect(story.getByRole('heading')).toHaveText('Vendor Desk → Payables');
    await expect(camera).toHaveAttribute('data-story-moving', 'false');
    const before = await camera.evaluate(element => ({ ...((element as HTMLElement).dataset) }));
    await story.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(story).toHaveCount(0);
    await expect(page.getByLabel('Office view')).toHaveValue('play');
    const surface = page.getByRole('application', { name: /First-person office/ });
    await expect(surface).toBeFocused();
    await expect(surface).toHaveAttribute('data-player-x', before.playerX!);
    await expect(surface).toHaveAttribute('data-player-z', before.playerZ!);
    await expect(surface).toHaveAttribute('data-player-yaw', before.playerYaw!);
    await page.keyboard.down('s');
    await expect.poll(async () => surface.getAttribute('data-player-z')).not.toBe(before.playerZ);
    await page.keyboard.up('s');
    expect(errors).toEqual([]);
  });
}

test('story deep link starts in first person and Escape skips a moving tour', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?demo=story');
  const story = page.getByRole('complementary', { name: 'Judge story mode' });
  await expect(story.locator('.story-kicker')).toContainText('Chapter 1 of 7');
  await expect(story.locator('.story-evidence')).toHaveText('Not recorded in this session');
  await expect(story.locator('[aria-live]')).toHaveText(/^Scripted walkthrough:/);
  await expect(page.locator('.office-caption')).not.toContainText('WASD');
  await expect(page.getByLabel('Office view')).toHaveValue('play');
  await expect(page.getByTestId('story-camera')).toHaveAttribute('data-story-moving', 'false');
  await story.getByRole('button', { name: 'Next', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(story).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('play');
  await expect(page.getByRole('application', { name: /First-person office/ })).toBeFocused();
  await expect(page).toHaveURL(/\/office$/);
  expect(errors).toEqual([]);
});

test('agent cards show Ready until the preview emits an escalation, with pills in overview', async ({ page }) => {
  // Observe the actual canvas paint as well as its snapshot mirror; a model-only update is insufficient.
  await page.addInitScript(() => {
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
      if (text === 'READY' || text === 'NEEDS YOU') document.documentElement.setAttribute(`data-painted-${text === 'READY' ? 'ready' : 'needs-you'}`, 'true');
      if (maxWidth === undefined) fillText.call(this, text, x, y);
      else fillText.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto('/office?view=overview');
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  const alexTag = async () => {
    const cards = JSON.parse(await canvas.getAttribute('data-agent-cards') ?? '[]') as { agentId: string; tag: string }[];
    return cards.find(card => card.agentId === 'collections-clerk')?.tag;
  };
  await expect.poll(alexTag).toBe('READY');
  await expect(page.locator('html')).toHaveAttribute('data-painted-ready', 'true');
  await expect(canvas).toHaveAttribute('data-agent-card-view', 'pill');
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(canvas).toHaveAttribute('data-agent-card-view', 'full');
  await expect.poll(alexTag).toBe('READY');
  await page.getByLabel('Office view').selectOption({ label: 'Orbit camera' });
  const menu = page.getByRole('button', { name: 'Backroom menu' });
  await menu.click();
  await page.getByRole('button', { name: 'Preview escalation', exact: true }).click();
  await expect.poll(alexTag).toBe('NEEDS YOU');
  await expect(page.locator('html')).toHaveAttribute('data-painted-needs-you', 'true');
  const cards = JSON.parse(await canvas.getAttribute('data-agent-cards') ?? '[]') as { agentId: string; tag: string }[];
  expect(cards.find(card => card.agentId === 'payables-clerk')?.tag).toBe('READY');
});
