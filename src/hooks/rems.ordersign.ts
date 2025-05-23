import {
  OrderSignHook,
  SupportedHooks,
  TypedResponseBody
} from '../rems-cds-hooks/resources/HookTypes';
import { ServicePrefetch, CdsService } from '../rems-cds-hooks/resources/CdsService';
import { handleHook } from './hookResources';

interface TypedRequestBody extends Express.Request {
  body: OrderSignHook;
}

const hookPrefetch: ServicePrefetch = {
  patient: 'Patient/{{context.patientId}}',
  practitioner: '{{context.userId}}'
};
const definition: CdsService = {
  id: 'rems-order-sign',
  hook: SupportedHooks.ORDER_SIGN,
  title: 'REMS Requirement Lookup',
  description: 'REMS Requirement Lookup',
  prefetch: hookPrefetch
};

const handler = (req: TypedRequestBody, res: TypedResponseBody) => {
  console.log('REMS order-sign hook');
  const contextRequest = req.body.context.draftOrders?.entry?.[0]?.resource;
  handleHook(req, res, hookPrefetch, contextRequest);
};

export default { definition, handler };
