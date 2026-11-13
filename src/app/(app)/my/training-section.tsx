import { businessToday } from "@/server/services/sales";
import { myTraining } from "@/server/services/training";
import { MyTrainingPanel } from "./training-panel";

/** "My training" on My shifts: certificates you need and checklists you've been given (loads its own data). */
export async function MyTrainingSection({ employeeId }: { employeeId: string }) {
  const today = businessToday();
  const data = await myTraining(employeeId, today);
  if (data.certs.length === 0 && data.checklists.length === 0) return null;
  return <MyTrainingPanel data={data} today={today} />;
}
