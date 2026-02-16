-- Add profile and KYC columns to server_wallets table
-- Run this in Supabase SQL Editor

ALTER TABLE server_wallets
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS kyc_pan TEXT,
ADD COLUMN IF NOT EXISTS kyc_aadhaar TEXT,
ADD COLUMN IF NOT EXISTS kyc_bank_account TEXT,
ADD COLUMN IF NOT EXISTS kyc_ifsc TEXT,
ADD COLUMN IF NOT EXISTS kyc_holder_name TEXT,
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{"notifications": true, "sounds": true, "biometric": false}';

-- Optional: Create notifications table for future use
CREATE TABLE IF NOT EXISTS server_notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  icon TEXT DEFAULT '📢',
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_server_notifications_user ON server_notifications(user_id);
