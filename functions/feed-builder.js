const fetch = require("node-fetch");
const xmlToJson = require("fast-xml-parser");
const Podcast = require("podcast");

exports.handler = async (event, context) => {
  const querySeriesId = event.queryStringParameters.series
    ? event.queryStringParameters.series
    : event.path.split("/")[2];

  const queryFilter = event.queryStringParameters.series
    ? event.queryStringParameters.filter
    : event.path.split("/")[3];

  const rawSeries = await fetch(
    `https://prod-component-api.nm-services.nelonenmedia.fi/api/series/${querySeriesId}?app=supla&client=web&userroles=anonymous`
  )
    .then(response => response.json())
    .catch(error => console.error(error));

  if (!rawSeries || rawSeries.error) {
    return {
      statusCode: 404,
      body: `Series ${querySeriesId} not found.`
    };
  }

  const series = {
    title: !queryFilter
      ? rawSeries.metadata.title
      : `${rawSeries.metadata.title} (${queryFilter})`,
    description: rawSeries.metadata.meta.find(
      meta => meta.name === "description"
    ).content,
    imageUrl: rawSeries.metadata.jsonld.thumbnailUrl,
    siteUrl: rawSeries.metadata.jsonld["@id"]
  };

  const rawEpisodes = await fetch(
    `https://prod-component-api.nm-services.nelonenmedia.fi/api/component/2600350?offset=0&limit=${
      !queryFilter ? 20 : 200
    }&current_primary_content=podcast&current_series_content_order_direction=desc&current_series_id=${querySeriesId}&app=supla&client=web`
  )
    .then(response => response.json())
    .catch(error => console.error(error));

  // return {
  //   statusCode: 200,
  //   body: JSON.stringify(rawEpisodes),
  //   headers: {
  //     "content-type": "application/json"
  //   }
  // };

  const episodes = await Promise.all(
    rawEpisodes.items
      .filter(
        episode =>
          !queryFilter ||
          episode.title.toLowerCase().includes(queryFilter.toLowerCase())
      )
      .slice(0, 20)
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
            itunesDuration: episode.timebar.end,
            itunesImage: episode.media.images["1280x720"]
          }))
          .catch(error => console.error(error));
      })
  );

  let feed = new Podcast(series);

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
