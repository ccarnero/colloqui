import { z } from 'zod';

export const VOICE_PRESETS = [
  'M1', 'M2', 'M3', 'M4', 'M5',
  'F1', 'F2', 'F3', 'F4', 'F5',
] as const;

export const SynthesizeRequest = z.object({
  text: z.string().min(10, 'text must be at least 10 characters'),
  voice: z.enum(VOICE_PRESETS).default('M3'),
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/, 'language must be a 2-3 letter ISO code')
    .default('en'),
  totalSteps: z.number().int().min(2).max(16).default(8),
  speed: z.number().min(0.8).max(1.3).default(1.0),
});

export type SynthesizeRequest = z.infer<typeof SynthesizeRequest>;
