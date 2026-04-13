#!/bin/bash

# Easy run script for Liquor Management Software
# This script handles database setup, seeding, and starting the dev server

# Exit on error
set -e

echo "🚀 Starting Liquor Management Software..."

# Navigate to the project directory
cd "$(dirname "$0")"

# 1. Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️ .env file not found! Using default .env.example if available or creating a basic one..."
    if [ -f .env.example ]; then
        cp .env.example .env
    else
        echo "Creating basic .env file..."
        echo "DATABASE_URL=\"postgresql://liquor:liquor123@localhost:5432/liquordb?schema=public\"" > .env
        echo "NEXTAUTH_SECRET=\"mv-liquor-management-secret-key-2026\"" >> .env
        echo "NEXTAUTH_URL=\"http://localhost:3000\"" >> .env
    fi
fi

# 2. Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 3. Setup database (sync schema)
echo "📂 Syncing database schema..."
npx prisma db push

# 4. Seed database (optional, check if needed or just run it)
# To avoid duplicate errors on unique constraints, we can use prisma/seed.ts logic (upsert)
echo "🌱 Seeding database..."
npm run seed

# 5. Start the development server
echo "✨ Starting development server at http://localhost:3000"
npm run dev
