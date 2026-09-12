/**
 * Boot tasks for the long lived Node process.
 *
 * Deliberately does not run migrations: those go through the Render predeploy
 * command so a bad migration fails the deploy rather than the process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { seedDefaultSkills } = await import("@/lib/skills/registry");
  const { failStaleRuns } = await import("@/lib/db/queries");

  try {
    const seeded = await seedDefaultSkills();
    console.log(`[boot] ${seeded} default skills available`);
  } catch (error) {
    console.error("[boot] could not seed skills:", (error as Error).message);
  }

  try {
    // A deploy kills in-flight runs. Without this their rows sit on 'running'
    // forever and the UI shows a run that nothing is driving.
    const failed = await failStaleRuns();
    if (failed > 0) console.log(`[boot] marked ${failed} stale run(s) failed`);
  } catch (error) {
    console.error("[boot] could not reconcile stale runs:", (error as Error).message);
  }
}
