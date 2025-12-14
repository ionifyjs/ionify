import { expect, test } from 'vitest';
import { getOptimizationPreset, resolveOptimizationLevel } from '../src/cli/utils/optimization-level';

test('optimization level 0 disables all optimizations', () => {
  const preset = getOptimizationPreset(0);
  expect(preset.minifier).toBe('swc');
  expect(preset.treeshake.mode).toBe('off');
  expect(preset.scopeHoist.enable).toBe(false);
  expect(preset.scopeHoist.inlineFunctions).toBe(false);
  expect(preset.scopeHoist.constantFolding).toBe(false);
  expect(preset.scopeHoist.combineVariables).toBe(false);
});

test('optimization level 1 enables safe optimizations', () => {
  const preset = getOptimizationPreset(1);
  expect(preset.minifier).toBe('oxc');
  expect(preset.treeshake.mode).toBe('safe');
  expect(preset.scopeHoist.enable).toBe(true);
  expect(preset.scopeHoist.inlineFunctions).toBe(true);
  expect(preset.scopeHoist.constantFolding).toBe(false);
  expect(preset.scopeHoist.combineVariables).toBe(false);
});

test('optimization level 2 enables balanced optimizations', () => {
  const preset = getOptimizationPreset(2);
  expect(preset.minifier).toBe('oxc');
  expect(preset.treeshake.mode).toBe('safe');
  expect(preset.scopeHoist.enable).toBe(true);
  expect(preset.scopeHoist.inlineFunctions).toBe(true);
  expect(preset.scopeHoist.constantFolding).toBe(true);
  expect(preset.scopeHoist.combineVariables).toBe(true);
});

test('optimization level 3 enables aggressive optimizations', () => {
  const preset = getOptimizationPreset(3);
  expect(preset.minifier).toBe('oxc');
  expect(preset.treeshake.mode).toBe('aggressive');
  expect(preset.scopeHoist.enable).toBe(true);
  expect(preset.scopeHoist.inlineFunctions).toBe(true);
  expect(preset.scopeHoist.constantFolding).toBe(true);
  expect(preset.scopeHoist.combineVariables).toBe(true);
});

test('resolveOptimizationLevel prioritizes CLI over env', () => {
  const level = resolveOptimizationLevel(undefined, {
    cliLevel: 3,
    envLevel: '1',
  });
  expect(level).toBe(3);
});

test('resolveOptimizationLevel prioritizes env over config', () => {
  const level = resolveOptimizationLevel(1, {
    envLevel: '2',
  });
  expect(level).toBe(2);
});

test('resolveOptimizationLevel uses config when no CLI/env', () => {
  const level = resolveOptimizationLevel(2, {});
  expect(level).toBe(2);
});

test('resolveOptimizationLevel returns null when none specified', () => {
  const level = resolveOptimizationLevel(undefined, {});
  expect(level).toBeNull();
});

test('resolveOptimizationLevel handles string CLI input', () => {
  const level = resolveOptimizationLevel(undefined, {
    cliLevel: '3',
  });
  expect(level).toBe(3);
});

test('resolveOptimizationLevel ignores invalid levels', () => {
  const level = resolveOptimizationLevel(undefined, {
    cliLevel: 5, // invalid
    envLevel: '2',
  });
  expect(level).toBe(2);
});
