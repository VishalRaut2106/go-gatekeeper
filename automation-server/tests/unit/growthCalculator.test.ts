import { describe, it, expect } from 'vitest';
import { GrowthCalculator } from '../../src/analytics/growthCalculator.js';

describe('GrowthCalculator', () => {
  const calculator = new GrowthCalculator();

  it('calculates positive growth percentage correctly', () => {
    // 100 to 150 -> 50%
    const growth = calculator.calculateGrowthPercentage(150, 100);
    expect(growth).toBe(50);
  });

  it('calculates negative growth percentage correctly', () => {
    // 100 to 80 -> -20%
    const growth = calculator.calculateGrowthPercentage(80, 100);
    expect(growth).toBe(-20);
  });

  it('handles zero previous period cleanly', () => {
    expect(calculator.calculateGrowthPercentage(10, 0)).toBe(100);
    expect(calculator.calculateGrowthPercentage(0, 0)).toBe(0);
  });
});
