import {
  VkCommunityPreviewReader,
  computeVkCommunityPreviewFingerprint,
  type VkCommunityPublicationStatePort,
  type VkCommunityPublishingPreview,
} from './adapters/vk-community-publishing-adapter.ts';

export interface VkCommunityApprovalPacket {
  readonly preview: VkCommunityPublishingPreview;
  readonly previewFingerprint: string;
}

export interface VkCommunityApprovalPacketReaderOptions {
  readonly communityId: number;
  readonly publicationState: VkCommunityPublicationStatePort;
}

export class VkCommunityApprovalPacketReader {
  readonly #previewReader: VkCommunityPreviewReader;

  constructor(options: VkCommunityApprovalPacketReaderOptions) {
    this.#previewReader = new VkCommunityPreviewReader(options);
  }

  async prepare(publicationId: string): Promise<VkCommunityApprovalPacket> {
    const preview = await this.#previewReader.preview(publicationId);
    return Object.freeze({
      preview,
      previewFingerprint: computeVkCommunityPreviewFingerprint(preview),
    });
  }
}

export function createVkCommunityApprovalPacketReader(
  options: VkCommunityApprovalPacketReaderOptions,
): VkCommunityApprovalPacketReader {
  return new VkCommunityApprovalPacketReader(options);
}
