const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/log-violation', (req, res) => {
    console.log('Violation:', req.body);
    res.json({ success: true });
});

app.post('/api/log-head-rotation', (req, res) => {
    console.log('Head rotation:', req.body);
    res.json({ success: true });
});

app.post('/api/save-exam-results', (req, res) => {
    console.log('Exam results:', req.body);
    res.json({ success: true });
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});