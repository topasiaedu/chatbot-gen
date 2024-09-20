import { createClient } from '@supabase/supabase-js';
require('dotenv').config();

// Supabase service key and URL from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase URL or service key is missing.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
