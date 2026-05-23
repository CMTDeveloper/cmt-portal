import { z } from 'zod';

const EmergencyContactSchema = z.object({
  relation: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().min(1),
});

export const MemberDocSchema = z.object({
  mid: z.string().min(1),
  uid: z.string().nullable(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  type: z.enum(['Adult', 'Child']),
  gender: z.enum(['Male', 'Female', 'PreferNotToSay']),
  manager: z.boolean(),
  joinedAt: z.date(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  schoolGrade: z.string().nullable(),
  birthMonthYear: z.string().nullable(),
  volunteeringSkills: z.array(z.string()),
  foodAllergies: z.string().nullable(),
  emergencyContacts: z.tuple([EmergencyContactSchema, EmergencyContactSchema.nullable()]),
});

export type MemberDoc = z.infer<typeof MemberDocSchema>;
