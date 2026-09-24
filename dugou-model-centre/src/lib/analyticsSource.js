import * as localData from './localData'

// A worker owns one immutable input snapshot for its entire lifetime. Ordinary
// callers continue reading localData, including its preview / Time Machine rules.
let workerSnapshot = null
export const setAnalyticsWorkerSnapshot = (snapshot) => {
  if (typeof window !== 'undefined' || workerSnapshot) throw new Error('Analytics snapshot requires a fresh worker')
  if (!snapshot?.config || !Array.isArray(snapshot.investments) || !Array.isArray(snapshot.teamProfiles)) {
    throw new Error('Invalid analytics snapshot')
  }
  workerSnapshot = structuredClone(snapshot)
}

export const getSystemConfig = () => workerSnapshot ? structuredClone(workerSnapshot.config) : localData.getSystemConfig()
export const getInvestments = () => workerSnapshot ? structuredClone(workerSnapshot.investments) : localData.getInvestments()
export const getTeamProfiles = () => workerSnapshot ? structuredClone(workerSnapshot.teamProfiles) : localData.getTeamProfiles()
