# JustLend Address Book

This shared component stores JustLend address labels discovered from on-chain jToken activity and third-party label comparison workflows.

## Files

- `data/justlend-address-book.json`: shared address book used by multiple dashboard iterations.

## Consumers

- `iterations/v0.1.0/live-dashboard`: discovers and updates the address book during user address monitoring.
- `iterations/v0.2.0/live-dashboard`: reads address book metadata in the daily snapshot job and records its availability in Data Quality.

The address book is a shared component, not a private data file for any single dashboard version.
