// Missing Number (CSES, rating 800)
// https://cses.fi/problemset/task/1083
// Accepted 22/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){
    long long n;
    cin >> n;
    vector<long long> vec(n-1);
    for(int i=0;i<n-1;i++) cin >> vec[i];

    long long vecsum=0; //sum throughout the n-1 elements
    for(int i=0;i<n-1;i++){
        vecsum+=vec[i];
    }

    long long truesum=(n*(n+1))/2;

    cout << truesum-vecsum << endl;

    return 0;
}