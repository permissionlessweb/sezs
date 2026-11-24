import { Entity } from './components/EntityDisplay'
import {
  DelegateResponse,
  DelegationResponse,
} from './contracts/DaoVoteDelegation'

export type VoteDelegationModuleData = {
  /**
   * The address of the delegation contract.
   */
  address: string
}

export type DelegateWithEntity = DelegateResponse & { entity: Entity }
export type DelegationWithEntity = DelegationResponse & { entity: Entity }
