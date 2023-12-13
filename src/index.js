require("websocket-polyfill")
const { default: NDK, NDKRelaySet, NDKRelay, NDKRelayStatus, NDKSubscriptionCacheUsage } = require('@nostr-dev-kit/ndk')
const express = require("express");
const { nip19 } = require('nostr-tools')
const { readFile } = require('node:fs/promises');
const DOMPurify = require('isomorphic-dompurify');

// s flag to match newlines
const TMPL_RX = /<meta name="nometa_start"\/>.+<meta name="nometa_end"\/>/s;
const PORT = process.env.PORT;
const ROOT = process.env.NOMETA_ROOT;
const FILE = process.env.NOMETA_FILE;
const URL_TMPL = process.env.NOMETA_URL_TMPL;
const RELAYS = [
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.damus.io'
];

// global ndk
const ndk = new NDK({
  explicitRelayUrls: RELAYS,
  enableOutboxModel: false
});

const app = express();

const getKindName = (kind) => {
  switch (kind) {
    case 1: return 'Note';
    case 3: return 'Contact list';
    case 6: return 'Repost';
    case 7: return 'Reaction';
    case 8: return 'Badge award';
    case 16: return 'Repost';
    case 1063: return 'File';
    case 1311: return 'Chat message';
    case 1984: return 'Report';
    case 1985: return 'Label';
    case 9041: return 'Zap goal';
    case 9735: return 'Zap';
    case 9802: return 'Highlight';
    case 10000: return 'Mute list';
    case 10001: return 'Pin list';
    case 10003: return 'Bookmark list';
    case 10004: return 'Community list';
    case 10005: return 'Public chat list';
    case 10006: return 'Blocked relay list';
    case 10007: return 'Search relay list';
    case 10015: return 'Interest list';
    case 10030: return 'Emoji list';
    case 30000: return 'Profile list';
    case 30001: return 'List';
    case 30002: return 'Relay set';
    case 30003: return 'Bookmark set';
    case 30004: return 'Curation set';
    case 30008: return 'Profile badges';
    case 30009: return 'Badge definition';
    case 30015: return 'Interest set';
    case 30017: return 'Stall';
    case 30018: return 'Product';
    case 30023: return 'Post';
    case 30024: return 'Post draft';
    case 30030: return 'Emoji set';
    case 30311: return 'Live event';
    case 30315: return 'Status';
    case 30402: return 'Classified listing';
    case 30403: return 'Classified listing draft';
    case 31922: return 'Calendar event';
    case 31923: return 'Calendar event';
    case 31924: return 'Calendar';
    case 31925: return 'Calendar event RSVP';
    case 31989: return 'App recommendations';
    case 31990: return 'App info';
    case 34550: return 'Community';
    default: return `Event of kind ${kind}`
  }
}

const parseUrls = (str) => {
  const links = [];
  const urlRegex =
    /((?:http|ftp|https):\/\/[\w/\-?=%.]+\.(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}|(?:https?|ftp):\/\/[\w/\-?=%.]+\.(?:mp3|mp4|jpeg|jpg|png|webp|mov|ogg|gif))/g;
  str.split(urlRegex).map((a) => {
    if (a.match(/^https?:\/\//)) {
      links.push(a);
    }
    return a;
  });
  return links;
}

const parseLink = (link) => {
  const u = link.split("#")[0].split("?")[0];
  // console.log("link", link, u)
  if (u.endsWith(".mov") || u.endsWith(".mp4")) {
    return {
      type: "video",
      url: u,
    };
  } else if (u.includes("youtube.com/") || u.includes("youtu.be/")) {
    let id = "";
    if (u.includes("youtu.be/"))
      id = link
        ? link.split("youtu.be/")[1]?.split("?")[0]?.split("/")[0]
        : "";
    else if (u.includes("youtube.com/"))
      id = link ? link.split("?")[1]?.split("=")[1] : "";

    return {
      type: "youtube",
      url: `https://www.youtube.com/embed/${id}`,
    };
  } else if (u.endsWith(".mp3") || u.endsWith(".ogg")) {
    return {
      type: "audio",
      url: u,
    };
  } else if (
    u.endsWith(".webp") ||
    u.endsWith(".jpg") ||
    u.endsWith(".jpeg") ||
    u.endsWith(".gif") ||
    u.endsWith(".png")
  ) {
    return {
      type: "image",
      url: u,
    };
  } else {
    return {
      type: "url",
      url: u
    }
  }
}

const isShortContent = (kind) => kind === 1 || kind === 1311
const isTextContent = (kind) => isShortContent(kind) || kind === 30023 || kind === 30024

function san(s) {
  return DOMPurify.sanitize(s.replace(/[\n\r\t]/g,' '));
}

const parseMeta = (p) => {
  try {
    return JSON.parse(p?.content) || {}
  } catch {
    return {}
  }
}

const renderMeta = (e, p, langs) => {
  // console.log("render", e.rawEvent(), p.rawEvent(), langs)
  try {
    const meta = parseMeta(p);

    const tags = {
      siteName: '',
      title: '',
      description: '',
      url: '',
      site_name: '',
      images: [],
      videos: [],
      audios: [],
    }

    tags.siteName = `${meta.display_name || meta.name || nip19.npubEncode(e.pubkey)} on Nostr`
    if (e.kind === 0) {
      tags.title = `${meta.display_name || meta.name || 'Profile'} (${nip19.npubEncode(e.pubkey)}) on Nostr`;
      tags.description = `${meta.about}`
      tags.images.push(meta.picture);
      tags.url = `${URL_TMPL.replace("<bech32>", nip19.npubEncode(e.pubkey))}`
    } else {
      const getTag = (k) => e.tags.filter(t => t.length > 1 && t[0] === k).map(t => t[1])?.[0] || ''
      const d = getTag('d')
      const id = (e.kind >= 10000 && e.kind < 20000)
        || (e.kind >= 30000 && e.kind < 40000)
        ? nip19.naddrEncode({ pubkey: e.pubkey, identifier: d, kind: e.kind })
        : nip19.noteEncode(e.id);
//        : nip19.neventEncode({ id: e.id, relays: [e.relay] });

      const name = `${meta.display_name || meta.name || nip19.npubEncode(e.pubkey)}`;
      const title = `${getTag('title') || getTag('name') || ''}`;
      const body = isShortContent(e.kind) ? e.content.substring(0, 200)
        : (getTag('summary') || getTag('description') || getTag('alt') || '');

      const type = getKindName(e.kind)

      tags.title = `${name} on Nostr: ${(title || body).substring(0, 60)}...`;
      tags.description = `${type}: ${body}`;
      tags.url = `${URL_TMPL.replace("<bech32>", id)}`

      const links = parseUrls(isTextContent(e.kind) ? e.content : body);
      // console.log("links", links)
      for (const u of links) {
        const link = parseLink(u);
        // console.log("link", link)
        switch (link.type) {
          case 'image':
            tags.images.push(link.url);
            break;
          case 'video':
          case 'youtube':
            tags.videos.push(link.url);
            break;
          case 'audio':
            tags.audios.push(link.url);
            break;
        }
      }

    }

    // FIXME use 'type=profile' for kind 0
    // FIXME for each kind look for proper type, like video.movie etc
    // FIXME localize!

    let result = `
    <title>${san(tags.title)}</title>
    <meta property="og:title" content="${san(tags.title)}"/>
    <meta property="twitter:title" content="${san(tags.title)}"/>
    <meta
      name="description"
      content="${san(tags.description)}"
    />
    <meta property="og:description" content="${san(tags.description)}"/>
    <meta property="twitter:description" content="${san(tags.description)}"/>
    <link rel="canonical" href="${san(tags.url)}" />
    <meta property="og:url" content="${san(tags.url)}"/>
    <meta name="og:type" content="website"/>
    <meta name="twitter:site" content="@nostrprotocol" />
    <meta name="twitter:card" content="${tags.images.length ? "summary" /*_large_image*/ : "summary"}"/>
    <meta property="og:site_name" content="${san(tags.siteName)}" />
    `;
    for (const u of tags.images) {
      result += `
    <meta property="twitter:image" content="${san(u)}" />
    <meta property="twitter:image:alt" content="${san(tags.title)}"
    <meta property="og:image" content="${san(u)}"/>
      `;  
    }
    for (const u of tags.videos) {
      result += `
    <meta property="og:video" content="${san(u)}"/>
      `;  
    }
    for (const u of tags.audios) {
      result += `
    <meta property="og:audio" content="${san(u)}"/>
      `;  
    }

    return result;

  } catch (e) {
    console.log("error", e)
    return ""
  }
}

const fetch = async (req, res, bech32, type, data) => {
  const start = Date.now()

  const filter = {}
  const relays = []
  switch (type) {
    case 'npub':
      filter.kinds = [0];
      filter.authors = [data];
      break;
    case 'note':
      filter.ids = [data];
      break;
    case 'nprofile':
      filter.kinds = [0];
      filter.authors = [data.pubkey];
      relays.push(...data.relays);
      break;
    case 'nevent':
      filter.ids = [data.id];
      relays.push(...data.relays);
      break;
    case 'naddr':
      filter.kinds = [data.kind];
      filter.authors = [data.pubkey];
      filter['#d'] = [data.identifier];
      relays.push(...data.relays);
      break;
  }

  // FIXME setup ndk cache

  // connect to those hinted relays too
  const relaySet = NDKRelaySet.fromRelayUrls([...relays, ...RELAYS], ndk);
  // for (const r of relaySet.relays.values())
  //   console.log("r", r.url, r.status)
  const event = await ndk.fetchEvent(filter,
    { groupable: false }, relaySet
  );

  if (!event) {
    res.sendFile(FILE, {
      root: ROOT,
      dotfiles: 'deny'
    })
    return    
  }

  let profile = event
  if (event.kind !== 0) {
    profile = await ndk.fetchEvent({ authors: [event.pubkey], kinds: [0] },
      { groupable: false }, relaySet
    );
  }

  const langs = req.header('accept-language')?.split(',').filter(l => !!l) || []

  const meta = renderMeta(event, profile, langs);

  // read ROOT+FILE, replace %META% with our content
  const file = await readFile(ROOT + FILE, { encoding: 'utf-8' });

  console.log("rendered", 
    bech32, event.kind, 
    nip19.npubEncode(event.pubkey), 
    "in", Date.now() - start)

  res.send(file.replace(TMPL_RX, meta))
}

const BECH32_REGEX = /[a-z]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/g
app.get('/*', async (req, res) => {
  try {
    const array = [...req.path.matchAll(BECH32_REGEX)].map((a) => a[0])
    if (array.length > 0) {
      const bech32 = array[0]
      const { type, data } = nip19.decode(bech32)

      switch (type) {
        case 'npub':
        case 'note':
        case 'nevent':
        case 'naddr':
        case 'nprofile':
          return fetch(req, res, bech32, type, data)
      }
    }
  } catch (e) { }

  res.sendFile(req.path, {
    root: ROOT,
    dotfiles: 'deny'
  }, (err) => {
    if (err && err.code === 'ENOENT') {
      res.sendFile(FILE, {
        root: ROOT,
        dotfiles: 'deny'
      })
    } else if (err) {
      console.log("err", req.url, err)
      res.sendStatus(404)
    }
  });
})

ndk.connect().then(() => {
  app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}!`);
  });
})
