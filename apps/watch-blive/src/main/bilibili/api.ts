import type {
  LiveArea,
  RoomCandidate,
  RoomInfo,
  StreamerHistory,
  StreamerHistoryItem,
} from '../../shared/types.ts';

interface ApiResponse<T> {
  code: number;
  message: string;
  data?: T;
}

interface BilibiliApiOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class BilibiliApi {
  private readonly fetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private areaGroups?: readonly LiveArea[];

  constructor(options: BilibiliApiOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async areas(): Promise<readonly LiveArea[]> {
    const data = await this.request<{ data?: readonly AreaGroup[] }>(
      'https://api.live.bilibili.com/xlive/web-interface/v1/index/getWebAreaList?source_id=2',
    );

    this.areaGroups = (data.data ?? []).flatMap(group => {
      if (!validId(group.id) || !group.name) {
        return [];
      }

      return [
        {
          id: group.id,
          name: group.name,
          children: (group.list ?? []).flatMap(area => {
            const id = Number(area.id);

            return validId(id) && area.name ? [{ id, name: area.name, children: [] }] : [];
          }),
        },
      ];
    });
    return this.areaGroups;
  }

  async room(roomId: number): Promise<RoomInfo> {
    assertPositiveInteger(roomId, 'roomId');

    const room = await this.request<RoomPayload>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?id=${roomId}`,
    );
    const streamerUid = room.uid ?? 0;
    const status = streamerUid > 0 ? await this.streamerStatus(streamerUid) : undefined;

    return {
      roomId: room.room_id ?? roomId,
      streamerUid,
      streamerName: status?.uname ?? `UID ${streamerUid}`,
      title: room.title ?? `直播间 ${roomId}`,
      description: room.description ?? '',
      parentAreaName: room.parent_area_name ?? '未知',
      areaName: room.area_name ?? '未知',
      live: room.live_status === 1,
    };
  }

  async roomByStreamer(streamerUid: number): Promise<RoomInfo> {
    assertPositiveInteger(streamerUid, 'streamerUid');

    const status = await this.streamerStatus(streamerUid);

    if (!validId(status?.room_id)) {
      throw new Error(`主播 UID ${streamerUid} 没有可用的直播间`);
    }

    return this.room(status.room_id);
  }

  async rooms(areaId: number, page = 1): Promise<readonly RoomCandidate[]> {
    assertPositiveInteger(areaId, 'areaId');
    assertPositiveInteger(page, 'page');

    const groups = this.areaGroups ?? (await this.areas());
    const parent = groups.find(group => group.id === areaId);
    const group = parent ?? groups.find(item => item.children.some(area => area.id === areaId));

    if (!group) {
      throw new Error(`未知直播分区 ${areaId}，请刷新分区列表`);
    }

    const query = new URLSearchParams({
      area_id: parent ? '0' : String(areaId),
      page: String(page),
      page_size: '20',
      parent_area_id: String(group.id),
      platform: 'web',
      sort_type: 'online',
    });
    const data = await this.request<{ list?: readonly CandidatePayload[] }>(
      `https://api.live.bilibili.com/room/v3/area/getRoomList?${query}`,
    );

    return (data.list ?? []).flatMap(item => {
      if (!validId(item.roomid) || !validId(item.uid) || !item.title) {
        return [];
      }

      return [
        {
          roomId: item.roomid,
          streamerUid: item.uid,
          streamerName: item.uname ?? `UID ${item.uid}`,
          title: item.title,
          areaName: item.area_name ?? '未知',
        },
      ];
    });
  }

  async playUrl(roomId: number): Promise<string> {
    assertPositiveInteger(roomId, 'roomId');

    const query = new URLSearchParams({
      room_id: String(roomId),
      protocol: '0,1',
      format: '0,1,2',
      codec: '0,1,2',
      qn: '10000',
      platform: 'web',
      ptype: '8',
    });
    const data = await this.request<PlayInfoPayload>(
      `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?${query}`,
    );

    if (data.live_status !== 1) {
      throw new Error(`直播间 ${roomId} 当前未开播`);
    }

    const stream = data.playurl_info?.playurl?.stream?.find(
      candidate => candidate.protocol_name === 'http_stream',
    );
    const format = stream?.format?.find(candidate => candidate.format_name === 'flv');
    const codec =
      format?.codec?.find(candidate => candidate.codec_name === 'avc') ?? format?.codec?.[0];
    const url = codec?.url_info?.[0];

    if (!codec?.base_url || !url?.host) {
      throw new Error('Bilibili 未返回可用的 FLV 地址');
    }

    return `${url.host}${codec.base_url}${url.extra ?? ''}`;
  }

  async streamerHistory(streamerUid: number): Promise<StreamerHistory> {
    assertPositiveInteger(streamerUid, 'streamerUid');

    const query = new URLSearchParams({
      host_mid: String(streamerUid),
      features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
    });
    const dynamicRequest = this.request<DynamicFeedPayload>(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${query}`,
      `https://space.bilibili.com/${streamerUid}/dynamic`,
    );
    const archiveQuery = new URLSearchParams({
      mid: String(streamerUid),
      pn: '1',
      ps: '8',
      order: 'pubdate',
    });
    const archiveRequest = this.request<ArchiveListPayload>(
      `https://api.bilibili.com/x/space/arc/search?${archiveQuery}`,
      `https://space.bilibili.com/${streamerUid}/video`,
    );
    const [dynamicResult, archiveResult] = await Promise.allSettled([
      dynamicRequest,
      archiveRequest,
    ]);

    if (dynamicResult.status === 'rejected' && archiveResult.status === 'rejected') {
      throw new AggregateError(
        [dynamicResult.reason, archiveResult.reason],
        `无法读取主播 ${streamerUid} 的近期公开信息`,
      );
    }

    const dynamicItems =
      dynamicResult.status === 'fulfilled'
        ? (dynamicResult.value.items ?? []).flatMap(parseHistoryItem)
        : [];
    const sorted = dynamicItems.toSorted(
      (left, right) => Number(right.pinned) - Number(left.pinned),
    );
    const archiveItems =
      archiveResult.status === 'fulfilled'
        ? (archiveResult.value.list?.vlist ?? []).flatMap(parseArchiveItem)
        : [];

    return {
      dynamics: sorted.slice(0, 8),
      videos: (archiveItems.length
        ? archiveItems
        : sorted.filter(item => item.type === 'video')
      ).slice(0, 8),
    };
  }

  private async streamerStatus(streamerUid: number) {
    const data = await this.request<Record<string, StreamerStatusPayload>>(
      `https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?uids[]=${streamerUid}`,
    );

    return data[String(streamerUid)];
  }

  private async request<T>(url: string, referer = 'https://live.bilibili.com/'): Promise<T> {
    const response = await this.fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: referer,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Bilibili API HTTP ${response.status}`);
    }

    const body = (await response.json()) as ApiResponse<T>;

    if (body.code !== 0 || body.data === undefined) {
      throw new Error(`Bilibili API ${body.code}: ${body.message}`);
    }

    return body.data;
  }
}

interface AreaGroup {
  id?: number;
  name?: string;
  list?: readonly { id?: string; name?: string }[];
}

interface CandidatePayload {
  roomid?: number;
  uid?: number;
  uname?: string;
  title?: string;
  area_name?: string;
}

interface RoomPayload {
  room_id?: number;
  uid?: number;
  title?: string;
  description?: string;
  parent_area_name?: string;
  area_name?: string;
  live_status?: number;
}

interface StreamerStatusPayload {
  room_id?: number;
  uname?: string;
}

interface PlayInfoPayload {
  live_status?: number;
  playurl_info?: { playurl?: { stream?: readonly StreamPayload[] } };
}

interface DynamicFeedPayload {
  items?: readonly DynamicItemPayload[];
}

interface ArchiveListPayload {
  list?: { vlist?: readonly ArchiveItemPayload[] };
}

interface ArchiveItemPayload {
  bvid?: string;
  title?: string;
  created?: number;
}

interface DynamicItemPayload {
  id_str?: string;
  type?: string;
  modules?: {
    module_author?: { pub_ts?: number };
    module_dynamic?: {
      desc?: { text?: string };
      major?: { archive?: { bvid?: string; title?: string } };
    };
    module_tag?: { text?: string };
  };
}

interface StreamPayload {
  protocol_name?: string;
  format?: readonly {
    format_name?: string;
    codec?: readonly {
      codec_name?: string;
      base_url?: string;
      url_info?: readonly { host?: string; extra?: string }[];
    }[];
  }[];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!validId(value)) {
    throw new Error(`${name} 必须是正整数`);
  }
}

function validId(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function parseHistoryItem(item: DynamicItemPayload): StreamerHistoryItem[] {
  const archive = item.modules?.module_dynamic?.major?.archive;
  const description = item.modules?.module_dynamic?.desc?.text?.trim();
  const title = archive?.title?.trim() || description;

  if (!title) {
    return [];
  }

  return [
    {
      id: archive?.bvid || item.id_str || title,
      type: archive ? 'video' : 'dynamic',
      title,
      publishedAt: item.modules?.module_author?.pub_ts,
      pinned: item.modules?.module_tag?.text?.includes('置顶') ?? false,
    },
  ];
}

function parseArchiveItem(item: ArchiveItemPayload): StreamerHistoryItem[] {
  const title = item.title?.trim();

  if (!title) {
    return [];
  }

  return [
    {
      id: item.bvid || title,
      type: 'video',
      title,
      publishedAt: item.created,
      pinned: false,
    },
  ];
}
