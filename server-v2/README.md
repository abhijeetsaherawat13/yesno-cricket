# YesNo Cricket Server v2

Clean slate backend implementation with modular architecture.

## Architecture

```
server-v2/
├── index.js                 # Entry point
├── app.js                   # Express setup + middleware
├── socket.js                # Socket.io setup
│
├── routes/
│   ├── auth.js              # POST /api/auth/verify-otp
│   ├── portfolio.js         # GET /api/portfolio
│   ├── trading.js           # POST /api/trade, POST /api/close
│   ├── markets.js           # GET /api/markets
│   └── admin.js             # POST /api/admin/settle
│
├── services/
│   ├── userService.js       # User management
│   ├── tradingService.js    # Trade execution
│   ├── settlementService.js # Match settlement
│   ├── marketService.js     # Market data
│   └── priceHistoryService.js
│
├── datasources/
│   ├── index.js             # DataSource interface
│   ├── dcric99.js           # dcric99 implementation
│   └── mock.js              # Mock data for testing
│
├── db/
│   ├── client.js            # Supabase client
│   ├── users.js             # User queries
│   ├── positions.js         # Position queries
│   ├── transactions.js      # Transaction queries
│   └── settlements.js       # Settlement queries
│
├── lib/
│   ├── state.js             # In-memory state
│   ├── constants.js         # Config values
│   └── logger.js            # Logging
│
└── tests/
    ├── trading.test.js
    └── settlement.test.js
```

## Database Schema

5 tables (vs 17 in v1):

1. **users** - User accounts with balance
2. **positions** - Open trading positions
3. **transactions** - Transaction audit trail
4. **settlements** - Match settlement records
5. **price_history** - Price data for charts

Run `migrations/001_initial_schema.sql` in Supabase SQL Editor.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your Supabase credentials

# Run migrations in Supabase SQL Editor
# (copy contents of migrations/001_initial_schema.sql)

# Start server
npm start

# Development with auto-reload
npm run dev
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/send-otp | Send OTP to phone |
| POST | /api/auth/verify-otp | Verify OTP, get user |
| GET | /api/portfolio | Get user's wallet + positions |
| GET | /api/markets | Get all active markets |
| POST | /api/trade | Execute a trade (buy) |
| POST | /api/trade/close | Close a position (sell) |
| POST | /api/admin/settle | Settle a match (admin) |
| GET | /health | Health check |

## Environment Variables

```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-key
ADMIN_API_KEY=your-admin-key
DCRIC99_ENABLED=true
```

## Testing

```bash
npm test
```

## Settlement

To settle a match:

```bash
curl -X POST http://localhost:3000/api/admin/settle \
  -H "Content-Type: application/json" \
  -H "x-admin-key: your-admin-key" \
  -d '{"matchKey": "ind-vs-aus-2024-02-18", "winner": "A"}'
```

Winner must be "A" or "B".
