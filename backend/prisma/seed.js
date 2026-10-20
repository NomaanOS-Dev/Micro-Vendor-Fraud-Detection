import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rules = [
  {
    ruleCode: 'duplicate_utr',
    ruleName: 'Duplicate UTR',
    score: 60,
    description: 'The same UTR was previously submitted by this vendor.',
  },
  {
    ruleCode: 'amount_mismatch',
    ruleName: 'Amount mismatch',
    score: 40,
    description: 'Submitted amount differs from the expected amount.',
  },
  {
    ruleCode: 'future_date',
    ruleName: 'Future transaction date',
    score: 20,
    description: 'Transaction date is later than the current time.',
  },
  {
    ruleCode: 'structuring',
    ruleName: 'Small transaction structuring',
    score: 30,
    description: 'Five or more transactions below INR 500 were ingested within ten minutes.',
  },
  {
    ruleCode: 'odd_time',
    ruleName: 'Suspicious transaction time',
    score: 20,
    description: 'Transaction occurred between 1:00 AM and 4:00 AM in vendor local time.',
  },
  {
    ruleCode: 'metadata_tampered',
    ruleName: 'Editing software metadata indicator',
    score: 50,
    description: 'Screenshot metadata names image-editing software; this is an indicator, not proof of alteration.',
  },
  {
    ruleCode: 'metadata_missing',
    ruleName: 'Uploaded screenshot metadata missing',
    score: 50,
    description: 'Uploaded screenshot has no usable capture/device metadata; this is a weak signal, not proof of alteration.',
  },
];

try {
  for (const rule of rules) {
    await prisma.riskRule.upsert({
      where: { ruleCode: rule.ruleCode },
      create: rule,
      update: {
        ruleName: rule.ruleName,
        score: rule.score,
        description: rule.description,
      },
    });
  }
} finally {
  await prisma.$disconnect();
}

