import asyncio
import hashlib
from argon2 import PasswordHasher
import asyncpg


async def seed() -> None:
    conn = await asyncpg.connect(
        "postgresql://dev:dev@localhost:5432/humanite_dev"
    )
    ph = PasswordHasher(memory_cost=65536, time_cost=3, parallelism=4)

    users = [
        ("free@humanite.dev", ph.hash("password123"), "free"),
        ("pro@humanite.dev", ph.hash("password123"), "pro"),
        ("admin@humanite.dev", ph.hash("password123"), "enterprise"),
    ]
    for email, pw_hash, tier in users:
        await conn.execute(
            """
            INSERT INTO users (email, password_hash, tier, region)
            VALUES ($1, $2, $3, 'us-east-1')
            ON CONFLICT (email) DO NOTHING
            """,
            email,
            pw_hash,
            tier,
        )

    print(f"Seeded {len(users)} dev users")
    await conn.close()


asyncio.run(seed())
