import { ApiClient } from "../client.ts";
import { requireSession } from "../config.ts";
import { type OutputOpts, writeObject } from "../output.ts";

function client(): ApiClient {
  return new ApiClient(requireSession());
}

/**
 * Link already-uploaded files to a resource (POST /attachments). For images on
 * an article use `resource_type: "article_photo"` and `resource_id: <article_id>`.
 * Other documented types: article_document, campaign_questionnaire, profile_logo,
 * profile_asset, product_image, product_logo, product_screenshot, outlet_logo,
 * content_type_image.
 */
export async function createAttachment(
  fileIds: string[],
  resourceType: string,
  resourceId: string,
  opts: OutputOpts,
): Promise<void> {
  if (fileIds.length < 1 || fileIds.length > 50) {
    throw new Error(`--file-ids must contain between 1 and 50 ids (got ${fileIds.length})`);
  }
  const res = await client().json("POST", "/attachments", {
    file_ids: fileIds,
    resource_type: resourceType,
    resource_id: resourceId,
  });
  writeObject(res, opts);
}
