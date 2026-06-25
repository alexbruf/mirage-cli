import { readFileSync } from "node:fs";
import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, unwrapList, writeObject, writeOutput } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

export interface ListOpts extends OutputOpts {
  limit?: number;
  page?: number;
  sortBy?: string;
  orderBy?: string;
  search?: string;
}

export async function listCampaigns(opts: ListOpts): Promise<void> {
  const res = await client().request<unknown>("/campaigns", {
    query: {
      limit: opts.limit,
      page: opts.page,
      sort_by: opts.sortBy,
      order_by: opts.orderBy,
      search: opts.search,
    },
  });
  writeOutput(unwrapList(res, ["campaigns"]), opts);
}

export async function getCampaign(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/campaigns/${id}`);
  writeObject(res, opts);
}

/**
 * Body for `POST /campaigns`. All fields below are required by the live
 * Zod-validated API even though the public docs imply most are optional and
 * imply `objectives`/`keywords` are arrays. They are strings — discovered
 * empirically against api.presscart.com on 2026-05-21.
 */
export interface CreateCampaignBody {
  name: string;
  description: string;
  profile_id: string;
  objectives: string;
  keywords: string;
  target_audience: string;
  tone: string;
  writing_samples: string;
  file_id: string;
}

export async function createCampaign(body: CreateCampaignBody, opts: OutputOpts): Promise<void> {
  const res = await client().json("POST", "/campaigns", body);
  writeObject(res, opts);
}

export async function createCampaignFromFile(file: string, opts: OutputOpts): Promise<void> {
  const body = JSON.parse(readFileSync(file, "utf8")) as CreateCampaignBody;
  return createCampaign(body, opts);
}

export async function updateCampaign(
  id: string,
  body: Partial<CreateCampaignBody>,
  opts: OutputOpts,
): Promise<void> {
  const res = await client().json("PUT", `/campaigns/${id}`, body);
  writeObject(res, opts);
}

export async function listCampaignArticles(id: string, opts: ListOpts): Promise<void> {
  const res = await client().request<unknown>(`/campaigns/${id}/articles`, {
    query: {
      limit: opts.limit,
      page: opts.page,
      sort_by: opts.sortBy,
      order_by: opts.orderBy,
    },
  });
  writeOutput(unwrapList(res, ["articles"]), opts);
}

export async function articleStatusCount(id: string, opts: OutputOpts): Promise<void> {
  const res = await client().request<unknown>(`/campaigns/${id}/articles/status-count`);
  writeObject(res, opts);
}

export async function assignOrderItems(
  campaignId: string,
  orderItemIds: string[],
  opts: OutputOpts,
): Promise<void> {
  const res = await client().json("POST", `/campaigns/${campaignId}/order-items`, {
    order_item_ids: orderItemIds,
  });
  writeObject(res, opts);
}

export interface UploadContentBody {
  order_id: string;
  profile_id: string;
  /** Attach to an existing campaign; omit and pass `campaign_name` to create one. */
  campaign_id?: string;
  campaign_name?: string;
}

/**
 * Create-or-select a campaign and attach a paid order's items to it in one call
 * (POST /teams/:slug/campaigns/upload-content). Returns `{ campaign_id }`; read
 * the generated article ids from the order's line items (`orders items`).
 */
export async function uploadContent(
  slug: string,
  body: UploadContentBody,
  opts: OutputOpts,
): Promise<void> {
  // Every placement must belong to a campaign. Require either an existing
  // campaign to attach to (--campaign-id) or a name to create a new one
  // (--campaign-name); never let it fall through to an unfiled placement.
  if (!body.campaign_id && !body.campaign_name) {
    throw new Error(
      "a campaign is required: pass --campaign-id to attach to an existing campaign, " +
        "or --campaign-name to create a new one",
    );
  }
  const res = await client().json("POST", `/teams/${slug}/campaigns/upload-content`, body);
  writeObject(res, opts);
}
