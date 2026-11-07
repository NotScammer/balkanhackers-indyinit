import { z } from "zod";
const items = z.array(z.string().trim().min(1).max(1500)).max(20);
export const candidateProfileSchema = z
  .object({
    experience: items,
    projects: items,
    skills: items,
    accomplishments: items,
  })
  .strict();
export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
export const personalizationSchema = z
  .object({
    profile: candidateProfileSchema.nullable().default(null),
    jobDescription: z.string().trim().max(30000).default(""),
  })
  .strict();
export type Personalization = z.infer<typeof personalizationSchema>;
