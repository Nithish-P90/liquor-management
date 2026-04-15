-- Face attendance support
-- Adds normalized face profiles and enrollment samples for reliable matching.

CREATE TABLE "FaceProfile" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.48,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "descriptor" JSONB,
    "enrolledAt" TIMESTAMP(3),
    "lastMatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FaceProfile_staffId_key" ON "FaceProfile"("staffId");

ALTER TABLE "FaceProfile"
ADD CONSTRAINT "FaceProfile_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FaceSample" (
    "id" SERIAL NOT NULL,
    "profileId" INTEGER NOT NULL,
    "descriptor" JSONB NOT NULL,
    "detectionScore" DOUBLE PRECISION NOT NULL,
    "qualityScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceSample_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaceSample_profileId_idx" ON "FaceSample"("profileId");

ALTER TABLE "FaceSample"
ADD CONSTRAINT "FaceSample_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "FaceProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
