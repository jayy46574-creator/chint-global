const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

require('dotenv').config();
console.log("DEBUG: MONGO_URI is:", process.env.MONGO_URI);

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const app = express();
app.use(cors());
app.use(express.json());

// Use the variable, not the hardcoded string
const dbUri = process.env.MONGO_URI;

if (!dbUri) {
    console.error("FATAL ERROR: MONGO_URI is not defined in your environment.");
    process.exit(1); // Stop the server immediately if there is no DB URI
}

mongoose.connect(dbUri)
  .then(() => console.log('✅ Connected to MongoDB successfully!'))
  .catch((err) => {
      console.error('❌ MongoDB connection error:', err);
      process.exit(1); 
  });
// 2. DATABASE SCHEMAS (MODELS)
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
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const depositSchema = new mongoose.Schema({
    email: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Pending' },
    createdAt: { type: Date, default: Date.now }
});
const Deposit = mongoose.model('Deposit', depositSchema);

const transactionSchema = new mongoose.Schema({
    txid: { type: String, required: true },
    email: { type: String, required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'Completed' },
    createdAt: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

// ==========================================
// 3. API ROUTES
// ==========================================
// 1. Update your signup route (Plain Text)
app.post('/api/signup', async (req, res) => {
    try {
        const { firstName, lastName, phone, country, email, password, address, referralId } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email already in use.' });
        }

        // Save the user with the RAW plain-text password
        const newUser = new User({ 
            firstName, lastName, phone, country, email, 
            password: password, // Store exactly what the user typed
            address, referralId 
        });
        await newUser.save();

        res.json({ success: true, message: 'User registered successfully!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
});

// 2. Update your Login Route (Plain Text Comparison)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        // Compare the incoming password directly with the stored plain-text password
        if (user && password === user.password) {
            res.json({ success: true, balance: user.balance });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});
// Get Specific User Data
// Find this in server.js and update it:
app.get('/api/user', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.query.email });
        if (user) {
            // FIX: Add firstName and lastName to this JSON response
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

// Request a Deposit
app.post('/api/deposit', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        const newDeposit = new Deposit({ email, amount: parseFloat(amount) });
        await newDeposit.save();

        res.json({ success: true, message: 'Deposit request submitted!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({}, '-__v'); // fetch all, ignore version key
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});
// Admin: Get all pending deposits
app.get('/api/admin/pending', async (req, res) => {
    try {
        // Find all deposits where the status is exactly 'Pending'
        const pendingDeposits = await Deposit.find({ status: 'Pending' });
        res.json(pendingDeposits);
    } catch (error) {
        console.error("Error fetching pending deposits:", error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin: Approve a deposit
app.post('/api/admin/approve-deposit', async (req, res) => {
    try {
        const { depositId } = req.body;
        
        // Find the pending deposit
        const deposit = await Deposit.findById(depositId);
        if (!deposit || deposit.status !== 'Pending') {
            return res.status(404).json({ success: false, message: 'Valid pending deposit not found' });
        }

        // Find the user and update their balance
        const user = await User.findOne({ email: deposit.email });
        if (user) {
            user.balance += deposit.amount;
            await user.save();

            // Log the transaction
            const txid = "TXN" + Math.floor(100000 + Math.random() * 900000);
            await Transaction.create({
                txid,
                email: deposit.email,
                type: 'Deposit',
                amount: deposit.amount,
                status: 'Completed'
            });

            // Update deposit status
            deposit.status = 'Approved';
            await deposit.save();

            res.json({ success: true, message: 'Deposit approved and balance updated.' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
// Admin: Update User Balance
app.post('/api/admin/update-balance', async (req, res) => {
    try {
        const { email, newBalance } = req.body;
        console.log(`DEBUG: Updating balance for ${email} to ${newBalance}`); // Check Render logs for this!
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Ensure we save it as a number
        user.balance = parseFloat(newBalance);
        await user.save();
        
        console.log("✅ Balance saved successfully!");
        res.json({ success: true, message: 'Balance updated successfully' });
    } catch (error) {
        console.error("❌ Error updating balance:", error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Admin: Delete User
app.post('/api/admin/delete-user', async (req, res) => {
    try {
        const { email } = req.body;
        const result = await User.deleteOne({ email });
        
        if (result.deletedCount > 0) {
            // Optional: Also delete their transactions and deposits to keep the database clean
            await Transaction.deleteMany({ email });
            await Deposit.deleteMany({ email });
            
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.status(404).json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get User Transactions
app.get('/api/transactions', async (req, res) => {
    try {
        const userTransactions = await Transaction.find({ email: req.query.email }).sort({ createdAt: -1 });
        res.json(userTransactions);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// 3. Process User Withdrawal Request
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

        // Deduct the balance
        user.balance -= parseFloat(amount);
        await user.save();

        // Create a record in Transaction History
        const txid = "TXN" + Math.floor(100000 + Math.random() * 900000);
        await Transaction.create({
            txid,
            email,
            type: 'Withdrawal',
            amount: parseFloat(amount),
            status: 'Completed'
        });

        res.json({ success: true, message: 'Withdrawal processed successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});