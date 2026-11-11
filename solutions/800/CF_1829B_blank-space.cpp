// Blank Space (Codeforces, rating 800)
// https://codeforces.com/problemset/problem/1829/B
// Accepted 21/10/2026

#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int t;
    cin >> t;

    while(t--){
        int n;
        cin >> n;

        vector<int> arr(n);
        for(int i=0;i<n;i++){
            cin >> arr[i];
        }

        int currlen=0, maxlen=0;
        for(int i=0;i<n;i++){
            if(arr[i]==0){
                currlen++;
                maxlen =max(currlen, maxlen);
            }
            else{
                currlen=0;
            }
        }
        cout << maxlen << endl;

    }


    return 0;
}
