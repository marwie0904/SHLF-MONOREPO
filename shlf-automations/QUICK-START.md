# SHLF Automation - Quick Start Guide

## ✅ Tests Completed Successfully!

All core business logic has been tested and verified working correctly.

---

## 🚀 How to Run

### 1. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```env
SUPABASE_URL=https://orbgkibbvvqendwlkirb.supabase.co
SUPABASE_KEY=your_actual_supabase_key
CLIO_ACCESS_TOKEN=your_actual_clio_token
```

### 2. Start the Server
```bash
npm run dev
```

You should see:
```
╔════════════════════════════════════════════╗
║   SHLF Legal Practice Automation System   ║
╚════════════════════════════════════════════╝

🚀 Server running on port 3000
📍 Environment: development
🔗 Webhook endpoints:
   - Matters:  http://localhost:3000/webhooks/matters
   - Tasks:    http://localhost:3000/webhooks/tasks
   - Calendar: http://localhost:3000/webhooks/calendar

✅ Ready to receive webhooks from Clio
```

### 3. Test Endpoints

**Health Check:**
```bash
curl http://localhost:3000/webhooks/health
```

**Test Matter Stage Change:**
```bash
curl -X POST http://localhost:3000/webhooks/matters \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "id": 1234567,
      "matter_stage": {
        "id": 828783,
        "name": "Pending Engagement"
      }
    }
  }'
```

---

## 📊 What Was Tested

### ✅ All Tests Passed

| Component | Status |
|-----------|--------|
| Date utilities (weekend detection) | ✅ PASSED |
| Assignee resolution (CSC, PARALEGAL, etc.) | ✅ PASSED |
| Attempt sequences (1→2→3→No Response) | ✅ PASSED |
| Calendar event mappings | ✅ PASSED |
| 3-minute rollback window | ✅ PASSED |
| Task template processing | ✅ PASSED |
| Server startup | ✅ PASSED |
| Webhook endpoints | ✅ PASSED |

**Run tests yourself:**
```bash
node test-runner.js
```

---

## 🎯 Next Steps

### For Testing with Real Data:

1. **Update .env with real credentials**
2. **Start server:** `npm run dev`
3. **Configure Clio webhooks** to point to your server:
   - `http://your-domain.com/webhooks/matters`
   - `http://your-domain.com/webhooks/tasks`
   - `http://your-domain.com/webhooks/calendar`
4. **Make a test change** in Clio (move a matter to new stage)
5. **Check logs** to see automation running
6. **Verify in Clio** that tasks were created
7. **Verify in Supabase** that records were saved

### For Production:

1. **Deploy to server** (AWS, DigitalOcean, etc.)
2. **Set up HTTPS** with SSL certificate
3. **Use process manager** (PM2):
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name shlf-automation
   pm2 save
   ```
4. **Configure Clio webhooks** to production URL
5. **Monitor logs:**
   ```bash
   pm2 logs shlf-automation
   ```

---

## 📁 Project Structure

```
shlf-automations/
├── src/
│   ├── automations/          # 3 main automations
│   │   ├── matter-stage-change.js
│   │   ├── task-completion.js
│   │   └── meeting-scheduled.js
│   ├── services/             # External integrations
│   │   ├── clio.js
│   │   └── supabase.js
│   ├── utils/                # Helper functions
│   │   ├── date-helpers.js
│   │   └── assignee-resolver.js
│   ├── routes/               # Express routes
│   │   └── webhooks.js
│   └── index.js              # Main server
├── test-runner.js            # Unit tests
├── test-server.js            # Server tests
├── TEST-RESULTS.md           # Full test report
└── README.md                 # Complete documentation
```

---

## 🐛 Troubleshooting

### Server won't start
- Check `.env` file exists
- Verify port 3000 is available
- Check Node.js version (need 18+)

### Tasks not creating
- Verify Supabase credentials
- Check Clio API token is valid
- Review server logs for errors
- Verify task templates exist in Supabase

### Wrong assignees
- Check `assigned_user_reference` table
- Verify matter has location/attorney data
- Review logs for assignee resolution

### Duplicate tasks
- Verify 3-minute rollback is working
- Check `matter-info` table updates
- Look for multiple webhook deliveries

---

## 📚 Documentation

- **README.md** - Complete system documentation
- **TEST-RESULTS.md** - Detailed test results
- **QUICK-START.md** - This file
- **Obsidian Canvases:**
  - Technical Flow (for developers)
  - Business Overview (for stakeholders)
  - Improvement Roadmap (for future enhancements)

---

## 💡 Tips

- **Check logs first** - All operations are logged with ✅/❌/⚠️ indicators
- **Test locally** before production deployment
- **Keep Make.com running** as backup during transition
- **Start with one matter** to test end-to-end flow
- **Monitor Supabase** to verify data is being saved correctly

---

## 🎉 You're Ready!

The automation system is built, tested, and ready to use. Just add your real credentials and start testing!

**Questions?** Review the README.md for detailed documentation.

**Issues?** Check the logs - they're very detailed and will show exactly what's happening.
