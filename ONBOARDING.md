# Developer Onboarding Guide

## Prerequisites

- Node.js 18+
- npm or yarn
- Git
- A GitHub account
- Freighter browser extension (for Stellar wallet)
- Rust (for Soroban contract development)

## Backend Setup

1. Clone the repository:
   \`\`\`bash
   git clone https://github.com/ritik4ever/stellar-bounty-board.git
   cd stellar-bounty-board
   \`\`\`

2. Install dependencies:
   \`\`\`bash
   cd backend
   npm install
   \`\`\`

3. Configure environment:
   \`\`\`bash
   cp .env.example .env
   # Edit .env with your settings
   \`\`\`

4. Start the development server:
   \`\`\`bash
   npm run dev
   \`\`\`

## Frontend Setup

1. Install frontend dependencies:
   \`\`\`bash
   cd frontend
   npm install
   \`\`\`

2. Start the frontend:
   \`\`\`bash
   npm run dev
   \`\`\`

## Soroban Contract Setup

1. Install Soroban CLI:
   \`\`\`bash
   cargo install soroban-cli
   \`\`\`

2. Navigate to contracts:
   \`\`\`bash
   cd contracts
   \`\`\`

3. Build and test:
   \`\`\`bash
   cargo build
   cargo test
   \`\`\`

## First Contribution

1. Find a "good first issue" label on GitHub
2. Comment \`/attempt\` to claim it
3. Create a branch, make changes, open a PR
4. Wait for review and merge
