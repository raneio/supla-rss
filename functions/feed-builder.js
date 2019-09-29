const fetch = require("node-fetch");
const xmlToJson = require("fast-xml-parser");
const Podcast = require("podcast");

exports.handler = async (event, context) => {
  const querySeries = event.queryStringParameters.series
    ? event.queryStringParameters.series
    : event.path.split("/")[2];
  const queryFilter = event.queryStringParameters.filter
    ? event.queryStringParameters.filter
    : event.path.split("/")[3];

  if (!querySeries || querySeries.length < 4) {
    return {
      statusCode: 404,
      body: `Series name "${querySeries}" need to be at least 4 character" (404)`
    };
  }

  const searchResult = await fetch(
    `https://prod-component-api.nm-services.nelonenmedia.fi/api/component/338?offset=0&limit=20&search_term=${querySeries}&app=supla&client=web`
  ).then(response => response.json());

  if (!searchResult || searchResult.error || searchResult.items.length === 0) {
    return {
      statusCode: 404,
      body: `Not found series (404)`
    };
  }

  const series = searchResult.items[0];

  const rawEpisodes = await fetch(
    `https://prod-component-api.nm-services.nelonenmedia.fi/api/component/2600350?offset=0&limit=20&current_primary_content=podcast&current_series_content_order_direction=desc&current_series_id=${series.id}&app=supla&client=web`
  ).then(response => response.json());

  const episodes = await Promise.all(
    rawEpisodes.items
      .filter(
        episode =>
          !queryFilter ||
          episode.title.toLowerCase().includes(queryFilter.toLowerCase())
      )
      .map(async episode => {
        return await fetch(
          `https://gatling.nelonenmedia.fi/media-xml-cache?id=${episode.id}&v=3`
        )
          .then(response => response.text())
          .then(response => xmlToJson.parse(response))
          .then(response => ({
            title: episode.title,
            description: response.Playerdata.Clip.Metadata.Description,
            url: `https://supla.fi/${episode.link.href}`,
            guid: episode.id,
            date: new Date(
              episode.subtitle_array.find(data => data.format === "timeago")
                .timestamp * 1000
            ),
            enclosure: {
              url: response.Playerdata.Clip.PlayBack.Media.StreamURLs.Audio
            },
            itunesImage: episode.media.images["1280x720"]
          }));
      })
  );

  let feed = new Podcast({
    title: !queryFilter ? series.title : `${series.title} (${queryFilter})`,
    description: series.description,
    imageUrl: series.media.images["1280x720"],
    siteUrl: `https://www.supla.fi${series.link.href}`
  });

  episodes.forEach(episode => {
    feed.addItem(episode);
  });

  return {
    statusCode: 200,
    body: feed.buildXml(),
    headers: {
      "content-type": "application/xml",
      "cache-control": `max-age=${60 * 15}`
    }
  };
};
