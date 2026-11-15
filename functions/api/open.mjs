// 鍵の要らない /api/v1/*（MCP と同じ道具を、ふつうの HTTP で）。GET はクエリ、POST は JSON。引数なしの GET は入力の説明。
import { restEndpoint } from '../_lib/open.mjs';
import { TOOL, SITE } from '../_lib/tools.mjs';

export const onCompare = restEndpoint(TOOL.compare_tax_methods, { site: SITE });
export const onPeriod = restEndpoint(TOOL.get_filing_period, { site: SITE });
export const onNormalYear = restEndpoint(TOOL.compare_normal_year, { site: SITE });
