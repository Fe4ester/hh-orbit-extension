export function hasReachedRunApplyLimit(maxAutoAppliesPerRun: number, successfulApplies: number): boolean {
  return maxAutoAppliesPerRun > 0 && successfulApplies >= maxAutoAppliesPerRun;
}
