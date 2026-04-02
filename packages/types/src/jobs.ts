import { z } from 'zod/v4';
import {
  CycleType,
  RemoteJobEnable,
  MaintenanceRequest,
  RemoteCycleSelection,
} from './enums.js';

/**
 * Job/commessa data from Mappatura IOT->AC500_9090.
 * R1_S_DATO_1=supervisor, R1_S_DATO_2=orderNumber, R1_S_DATO_3=serialNumber,
 * R1_I_DATO_1=remoteJobEnable, R1_I_DATO_2=maintenanceRequest,
 * R1_I_DATO_3=remoteCycleSelection, R1_I_DATO_4=cycleType
 */
export interface IJobData {
  supervisor: string;
  orderNumber: string;
  serialNumber: string;
  remoteJobEnable: RemoteJobEnable;
  maintenanceRequest: MaintenanceRequest;
  remoteCycleSelection: RemoteCycleSelection;
  cycleType: CycleType;
}

export const JobDataSchema = z.object({
  supervisor: z.string().max(20),
  orderNumber: z.string().max(20),
  serialNumber: z.string().max(20),
  remoteJobEnable: z.nativeEnum(RemoteJobEnable),
  maintenanceRequest: z.nativeEnum(MaintenanceRequest),
  remoteCycleSelection: z.nativeEnum(RemoteCycleSelection),
  cycleType: z.nativeEnum(CycleType),
});
