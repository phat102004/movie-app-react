-- Additive Favorite migration; existing authentication tables and rows stay intact.
BEGIN;

CREATE TABLE "Favorite" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "movieId" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");
CREATE UNIQUE INDEX "Favorite_userId_movieId_key" ON "Favorite"("userId", "movieId");
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
