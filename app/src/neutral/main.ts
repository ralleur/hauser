import { mount } from 'svelte';
import '../../../design-tokens/tokens.css';
import NeutralHarness from './NeutralHarness.svelte';
import { bootstrapNeutralRuntime } from '../lib/config/neutral-runtime.ts';

const result = await bootstrapNeutralRuntime();
const harness = mount(NeutralHarness, {
  target: document.body,
  props: { result },
});

export default harness;
