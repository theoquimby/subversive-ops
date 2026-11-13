-- CreateTable
CREATE TABLE "CertType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "issuer" TEXT,
    "validityMonths" INTEGER,
    "appliesTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredForAll" BOOLEAN NOT NULL DEFAULT false,
    "requiredForMinors" BOOLEAN NOT NULL DEFAULT false,
    "isAnnualTraining" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "certTypeId" TEXT NOT NULL,
    "number" TEXT,
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE,
    "expiryOverridden" BOOLEAN NOT NULL DEFAULT false,
    "bytes" BYTEA,
    "mime" TEXT,
    "size" INTEGER,
    "filename" TEXT,
    "notes" TEXT,
    "uploadedBy" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "positionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingStep" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "documentId" TEXT,

    CONSTRAINT "TrainingStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "dueOn" DATE,
    "completedAt" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "signedOffAt" TIMESTAMP(3),

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingStepCompletion" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedBy" TEXT,

    CONSTRAINT "TrainingStepCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertType_name_key" ON "CertType"("name");

-- CreateIndex
CREATE INDEX "Certification_employeeId_certTypeId_idx" ON "Certification"("employeeId", "certTypeId");

-- CreateIndex
CREATE INDEX "Certification_expiresOn_idx" ON "Certification"("expiresOn");

-- CreateIndex
CREATE INDEX "TrainingStep_moduleId_sort_idx" ON "TrainingStep"("moduleId", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAssignment_employeeId_moduleId_key" ON "TrainingAssignment"("employeeId", "moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingStepCompletion_assignmentId_stepId_key" ON "TrainingStepCompletion"("assignmentId", "stepId");

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_certTypeId_fkey" FOREIGN KEY ("certTypeId") REFERENCES "CertType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingStep" ADD CONSTRAINT "TrainingStep_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingStep" ADD CONSTRAINT "TrainingStep_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingStepCompletion" ADD CONSTRAINT "TrainingStepCompletion_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingStepCompletion" ADD CONSTRAINT "TrainingStepCompletion_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "TrainingStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
