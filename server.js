const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();
console.log("DEBUG: MONGO_URI is:", process.env.MONGO_URI);

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const app = express();

const allowedOrigins = [
  'https://chint-global.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: This origin is not allowed.'));
    }
  },
  credentials: true
}));

app.use(express.json());

const dbUri = process.env.MONGO_URI;

if (!dbUri) {
    console.error("FATAL ERROR: MONGO_URI is not defined in your environment.");
    process.exit(1);
}

mongoose.connect(dbUri)
  .then(() => console.log('✅ Connected to MongoDB successfully!'))
  .catch((err) => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1); 
  });

// ==========================================
// 2. DATABASE SCHEMAS
// ==========================================
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phone: String,
    country: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    address: String,
    referralId: { type: String, default: null },
    balance: { type: Number, default: 0 },
    platform: { type: String, default: 'chint' },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const depositSchema = new mongoose.Schema({
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    platform: { type: String, default: 'chint' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const withdrawalSchema = new mongoose.Schema({
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    platform: { type: String, default: 'chint' },
    createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

const transactionSchema = new mongoose.Schema({
    txid: { type: String, required: true },
    email: { type: String, required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    platform: { type: String, default: 'chint' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// ==========================================
// 3. API ROUTES
// ==========================================

app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, phone, country, email, password, address, referralId } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already in use.' });
        }

        const newUser = new User({ 
            firstName, lastName, phone, country, email, 
            password, address, referralId,
            platform: 'chint'
        });
        await newUser.save();
        res.json({ success: true, message: 'User registered successfully!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (user && password === user.password) {
            res.json({ success: true, balance: user.balance });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

app.get('/api/user', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.query.email });
        if (user) {
            res.json({ 
                success: true,
                balance: user.balance, 
                email: user.email,
                firstName: user.firstName, 
                lastName: user.lastName 
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Request Deposit (Creates Pending Deposit + Pending Transaction)
app.post('/api/deposit', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        const newDeposit = new Deposit({ 
            email, 
            amount: parseFloat(amount),
            platform: 'chint'
        });
        await newDeposit.save();

        const txid = "TXN" + Math.floor(100000 + Math.random() * 900000);
        await Transaction.create({
            txid,
            email,
            type: 'Deposit',
            amount: parseFloat(amount),
            status: 'Pending',
            platform: 'chint'
        });

        res.json({ success: true, message: 'Deposit request submitted successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Request Withdrawal (Creates Pending Withdrawal + Pending Transaction)
app.post('/api/withdraw', async (req, res) => {
    try {
        const { email, amount } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        const newWithdrawal = new Withdrawal({
            email,
            amount: parseFloat(amount),
            platform: 'chint'
        });
        await newWithdrawal.save();

        const txid = "TXN" + Math.floor(100000 + Math.random() * 900000);
        await Transaction.create({
            txid,
            email,
            type: 'Withdrawal',
            amount: parseFloat(amount),
            status: 'Pending',
            platform: 'chint'
        });

        res.json({ success: true, message: 'Withdrawal request submitted for approval!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Get all Pending Deposits and Withdrawals
app.get('/api/admin/pending', async (req, res) => {
    try {
        const pendingDeposits = await Deposit.find({ status: 'Pending', $or: [{ platform: 'chint' }, { platform: { $exists: false } }] });
        const pendingWithdrawals = await Withdrawal.find({ status: 'Pending', $or: [{ platform: 'chint' }, { platform: { $exists: false } }] });
        
        res.json({ deposits: pendingDeposits, withdrawals: pendingWithdrawals });
    } catch (error) {
        console.error("Error fetching pending requests:", error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin: Approve Deposit
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        const deposit = await Deposit.findById(depositId);
        if (!deposit || deposit.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending deposit not found' });
        }

        const user = await User.findOne({ email: deposit.email });
        if (user) {
            user.balance += deposit.amount;
            await user.save();

            deposit.status = 'Approved';
            await deposit.save();

            await Transaction.updateOne(
                { email: deposit.email, amount: deposit.amount, type: 'Deposit', status: 'Pending' },
                { status: 'Completed' }
            );

            res.json({ success: true, message: 'Deposit approved and balance updated.' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Approve Withdrawal
app.post('/api/admin/approve-withdrawal', async (req, res) => {
    try {
        const { withdrawalId } = req.body;
        const withdrawal = await Withdrawal.findById(withdrawalId);
        if (!withdrawal || withdrawal.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Pending withdrawal not found' });
        }

        const user = await User.findOne({ email: withdrawal.email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (user.balance < withdrawal.amount) {
            return res.status(400).json({ success: false, message: 'User has insufficient balance' });
        }

        user.balance -= withdrawal.amount;
        await user.save();

        withdrawal.status = 'Approved';
        await withdrawal.save();

        await Transaction.updateOne(
            { email: withdrawal.email, amount: withdrawal.amount, type: 'Withdrawal', status: 'Pending' },
            { status: 'Completed' }
        );

        res.json({ success: true, message: 'Withdrawal approved successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({ $or: [{ platform: 'chint' }, { platform: { $exists: false } }] }, '-__v');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/admin/update-balance', async (req, res) => {
    try {
        const { email, newBalance } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.balance = parseFloat(newBalance);
        await user.save();
        res.json({ success: true, message: 'Balance updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await User.deleteOne({ email });
        if (result.deletedCount > 0) {
            await Transaction.deleteMany({ email });
            await Deposit.deleteMany({ email });
            await Withdrawal.deleteMany({ email });
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

app.get('/api/transactions', async (req, res) => {
    try {
        const userTransactions = await Transaction.find({ email: req.query.email }).sort({ createdAt: -1 });
        res.json(userTransactions);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});