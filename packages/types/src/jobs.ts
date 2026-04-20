import { z } from 'zod/v4';
import {
  CycleType,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
} from './enums.js';

/**
 * Job/commessa data from Mappatura IOT->AC500_9090 (V03, 92 bytes: 4 STRING[20] + 6 INT).
 * R1_S_DATO_1=supervisor, R1_S_DATO_2=orderNumber, R1_S_DATO_3=serialNumber,
 * R1_I_DATO_1=remoteJobEnable, R1_I_DATO_2=maintenanceRequest,
 * R1_I_DATO_3=remoteCycleSelection, R1_I_DATO_4=cycleType,
 * R1_I_DATO_5=spareInt02 (V03 NEW), R1_I_DATO_6=spareInt03 (V03 NEW)
 */
export interface IJobData {
  supervisor: string;
  orderNumber: string;
  serialNumber: string;
  remoteJobEnable: RemoteJobEnable;
  maintenanceRequest: MaintenanceRequest;
  remoteCycleSelection: RemoteCycleSelection;
  cycleType: CycleType;
  /** R1_I_DATO_5 Spare_02 (V03 — bare int, wire position 88, no semantics yet) */
  spareInt02: number;
  /** R1_I_DATO_6 Spare_03 (V03 — bare int, wire position 90, no semantics yet) */
  spareInt03: number;
}

export const JobDataSchema = z.object({
  supervisor: z.string().min(1).max(20),
  orderNumber: z.string().min(1).max(20),
  serialNumber: z.string().min(1).max(20),
  remoteJobEnable: z.enum(RemoteJobEnable),
  maintenanceRequest: z.enum(MaintenanceRequest),
  remoteCycleSelection: z.enum(RemoteCycleSelection),
  cycleType: z.enum(CycleType),
  spareInt02: z.int(),
  spareInt03: z.int(),
});
