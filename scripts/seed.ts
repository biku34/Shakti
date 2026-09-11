/**
 * Seed synthetic-but-realistic Gandhinagar data (Appendix A) from the shared
 * manifest data/gandhinagar.json — the same file the Flask simulator reads, so
 * meter codes always line up. Run: `npm run seed` (requires MONGODB_URI).
 *
 * Wipes app collections first so re-runs give a clean demo state.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { resolve } from "path";
import { connectDB } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import type { Role } from "@/lib/roles";
import { UserModel } from "@/models/User";
import { FeederModel } from "@/models/Feeder";
import { MeterModel } from "@/models/Meter";
import { MeterReadingModel } from "@/models/MeterReading";
import { EnergyOfferModel } from "@/models/EnergyOffer";
import { EnergyBidModel } from "@/models/EnergyBid";
import { TradeModel } from "@/models/Trade";
import { RecCertificateModel } from "@/models/RecCertificate";
import { RecTransactionModel } from "@/models/RecTransaction";
import { FraudAlertModel } from "@/models/FraudAlert";
import { BlockchainAnchorModel } from "@/models/BlockchainAnchor";
import { PricingSnapshotModel } from "@/models/PricingSnapshot";

type Manifest = {
  demoPassword: string;
  globalUsers: { role: Role; name: string; email: string }[];
  feeders: {
    code: string;
    name: string;
    lat: number;
    lng: number;
    capacityKw: number;
    prosumers: { email: string; name: string; meterCode: string; solarCapacityKw: number }[];
    consumers: { email: string; name: string }[];
  }[];
};

async function main() {
  const manifest: Manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), "data/gandhinagar.json"), "utf-8"),
  );

  await connectDB();

  console.log("Wiping app collections…");
  await Promise.all([
    UserModel.deleteMany({}),
    FeederModel.deleteMany({}),
    MeterModel.deleteMany({}),
    MeterReadingModel.deleteMany({}),
    EnergyOfferModel.deleteMany({}),
    EnergyBidModel.deleteMany({}),
    TradeModel.deleteMany({}),
    RecCertificateModel.deleteMany({}),
    RecTransactionModel.deleteMany({}),
    FraudAlertModel.deleteMany({}),
    BlockchainAnchorModel.deleteMany({}),
    PricingSnapshotModel.deleteMany({}),
  ]);

  const pwd = await hashPassword(manifest.demoPassword);

  for (const g of manifest.globalUsers) {
    await UserModel.create({ role: g.role, name: g.name, email: g.email, passwordHash: pwd });
  }

  for (const f of manifest.feeders) {
    const feeder = await FeederModel.create({
      code: f.code,
      name: f.name,
      location: { lat: f.lat, lng: f.lng },
      capacityKw: f.capacityKw,
    });

    const meterIds: unknown[] = [];
    for (const p of f.prosumers) {
      const user = await UserModel.create({
        role: "prosumer",
        name: p.name,
        email: p.email,
        passwordHash: pwd,
        feederId: feeder._id,
        creditBalance: 100,
      });
      const meter = await MeterModel.create({
        code: p.meterCode,
        ownerId: user._id,
        feederId: feeder._id,
        solarCapacityKw: p.solarCapacityKw,
      });
      meterIds.push(meter._id);
    }

    for (const c of f.consumers) {
      await UserModel.create({
        role: "consumer",
        name: c.name,
        email: c.email,
        passwordHash: pwd,
        feederId: feeder._id,
        creditBalance: 200,
      });
    }

    feeder.connectedMeters = meterIds as never;
    await feeder.save();
    console.log(`Feeder ${f.code}: ${f.prosumers.length} prosumers, ${f.consumers.length} consumers`);
  }

  console.log("\nSeed complete. Demo login password:", manifest.demoPassword);
  console.log("Oversight logins: regulator@demo.reip · cert@demo.reip · auditor@demo.reip · utility@demo.reip");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
