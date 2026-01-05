import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
    TRA_API_KEY: z.string().min(1),
    PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
    DATABASE_URL: z.string().default('data/tra.db'),
});

export const config = envSchema.parse(process.env);
