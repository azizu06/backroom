/** Convert viewport measurements to a sheet-local scroll offset below its sticky chrome. */
export function helpAnchorScrollTop({ scrollTop, headingTop, scrollportTop, headerHeight, navigationHeight, maxScrollTop }: {
  scrollTop: number;
  headingTop: number;
  scrollportTop: number;
  headerHeight: number;
  navigationHeight: number;
  maxScrollTop: number;
}): number {
  const target = scrollTop + headingTop - scrollportTop - headerHeight - navigationHeight - 12;
  return Math.max(0, Math.min(maxScrollTop, target));
}
