import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { userService } from '../services/index.js';
import { log } from '../lib/logger.js';

const router = Router();

// Supabase client for auth verification
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl || '', supabaseKey || '', {
  auth: { persistSession: false }
});

// POST /api/auth/verify-otp
// Verify OTP and return user data
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, token } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Dev mode: skip OTP verification
    if (process.env.DISABLE_AUTH_FOR_TESTING === 'true') {
      const rawPhone = phone.replace(/^\+91/, '').replace(/^\+/, '');
      const user = await userService.ensureUser(rawPhone);

      log.info(`[Auth] User authenticated (test mode): ${rawPhone}`);

      return res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: rawPhone,
          balance: user.balance
        },
        session: null
      });
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and OTP token are required'
      });
    }

    // Verify OTP with Supabase
    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms'
    });

    if (error) {
      log.warn(`[Auth] OTP verification failed for ${phone}: ${error.message}`);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired OTP'
      });
    }

    // Extract phone number without country code
    const rawPhone = phone.replace(/^\+91/, '').replace(/^\+/, '');

    // Ensure user exists in our system
    const user = await userService.ensureUser(rawPhone);

    log.info(`[Auth] User authenticated: ${rawPhone}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        phone: rawPhone,
        balance: user.balance
      },
      session: data.session
    });
  } catch (err) {
    log.error('[Auth] verify-otp error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
});

// POST /api/auth/send-otp
// Send OTP to phone number
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Send OTP via Supabase
    const { error } = await supabase.auth.signInWithOtp({
      phone
    });

    if (error) {
      log.warn(`[Auth] Failed to send OTP to ${phone}: ${error.message}`);
      return res.status(400).json({
        success: false,
        error: 'Failed to send OTP'
      });
    }

    log.info(`[Auth] OTP sent to ${phone}`);

    res.json({
      success: true,
      message: 'OTP sent successfully'
    });
  } catch (err) {
    log.error('[Auth] send-otp error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send OTP'
    });
  }
});

// Middleware to require authentication
export async function requireAuth(req, res, next) {
  try {
    // Dev mode: allow x-user-id header to bypass auth
    if (process.env.DISABLE_AUTH_FOR_TESTING === 'true') {
      const userId = req.headers['x-user-id'];
      if (userId) {
        req.userId = userId;
        return next();
      }
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
    }

    const token = authHeader.substring(7);

    // Verify token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Extract phone number and set on request
    const rawPhone = (user.phone || '').replace(/^\+91/, '').replace(/^\+/, '');
    req.userId = rawPhone;
    req.user = user;

    next();
  } catch (err) {
    log.error('[Auth] requireAuth error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}

// Middleware for admin routes (simple check for now)
export function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey) {
    return res.status(500).json({
      success: false,
      error: 'Admin API key not configured'
    });
  }

  if (adminKey !== expectedKey) {
    return res.status(403).json({
      success: false,
      error: 'Admin access required'
    });
  }

  next();
}

export default router;
